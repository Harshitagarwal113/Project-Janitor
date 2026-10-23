from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from app.schemas.duplicate import (
    DuplicateAnalysisResponse,
    DuplicateFileItem,
    DuplicateGroup,
)
from app.schemas.scan import FileMetadata, SkippedEntry
from app.services.scanner import ScanRecord, scanner_service

CHUNK_SIZE = 65536  # 64 KB read buffer for flat memory footprint


class DuplicateService:
    """Service for exact cryptographic duplicate file analysis within an authorized scan root."""

    def __init__(self) -> None:
        self._duplicate_cache: Dict[str, DuplicateAnalysisResponse] = {}

    def _safe_resolve(self, canonical_root: Path, relative_path: str) -> Tuple[Optional[Path], Optional[str]]:
        """Safely resolve file path and enforce strict sandboxing within canonical root."""
        try:
            target = (canonical_root / relative_path).resolve()
        except OSError as e:
            return None, f"Failed to resolve path: {e}"

        # Sandboxing: Never allow traversal or symlinks outside authorized root
        try:
            if not target.is_relative_to(canonical_root):
                return None, "File path points outside authorized scan root directory"
        except AttributeError:
            try:
                target.relative_to(canonical_root)
            except ValueError:
                return None, "File path points outside authorized scan root directory"

        if not target.exists():
            return None, "File no longer exists on filesystem"

        if not target.is_file():
            return None, "Target is not a regular file"

        return target, None

    def _stat_file(self, file_path: Path) -> os.stat_result:
        """Read stat info for a file path."""
        return file_path.stat()

    def _hash_file(
        self,
        file_path: Path,
        expected_size: int,
    ) -> Tuple[Optional[str], Optional[str]]:
        """Calculate verified SHA-256 hash using chunked streaming.
        
        Detects unreadable files and files modified during hashing.
        Returns (sha256_hex, None) on success or (None, error_reason) on failure.
        """
        try:
            initial_stat = self._stat_file(file_path)
        except (PermissionError, OSError) as e:
            return None, f"Permission or I/O error checking file: {e}"

        # Detect size discrepancy before reading
        if initial_stat.st_size != expected_size:
            return None, f"File size changed prior to hashing (expected {expected_size}, found {initial_stat.st_size})"

        hasher = hashlib.sha256()
        bytes_read = 0

        try:
            with open(file_path, "rb") as f:
                while True:
                    chunk = f.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    bytes_read += len(chunk)
                    hasher.update(chunk)
        except PermissionError as e:
            return None, f"Permission denied reading file contents: {e}"
        except OSError as e:
            return None, f"I/O error during file read: {e}"

        # Verify bytes read matched initial stat size
        if bytes_read != initial_stat.st_size:
            return None, f"File size changed during hashing read (read {bytes_read} bytes, expected {initial_stat.st_size})"

        # Check post-read stat for concurrent modification during hashing
        try:
            post_stat = self._stat_file(file_path)
            if (
                post_stat.st_mtime_ns != initial_stat.st_mtime_ns
                or post_stat.st_size != initial_stat.st_size
            ):
                return None, "File was modified concurrently during hashing"
        except OSError as e:
            return None, f"Unable to verify file integrity after hashing: {e}"

        return hasher.hexdigest(), None

    def analyze_duplicates(
        self,
        scan_id: str,
        force_refresh: bool = False,
    ) -> DuplicateAnalysisResponse:
        """Perform exact duplicate detection on a previously executed scan record.
        
        1. Validates scan existence.
        2. Groups files by size before hashing (avoids redundant I/O for unique sizes).
        3. Hashes candidate files safely within authorized root using SHA-256.
        4. Detects mutating or unreadable files.
        5. Computes exact duplicate groups and conservative reclaimable bytes.
        """
        if not force_refresh and scan_id in self._duplicate_cache:
            return self._duplicate_cache[scan_id]

        scan_record: Optional[ScanRecord] = scanner_service.get_scan(scan_id)
        if not scan_record:
            raise KeyError(f"Scan with ID '{scan_id}' not found.")

        canonical_root = Path(scan_record.target_path).resolve()
        analyzed_at = datetime.now(timezone.utc).isoformat()
        skipped_files: List[SkippedEntry] = []

        # Step 1: Group candidate files by exact byte size
        # Files with unique sizes CANNOT be duplicates and are not hashed
        size_buckets: Dict[int, List[FileMetadata]] = defaultdict(list)
        for f in scan_record.files:
            size_buckets[f.size_bytes].append(f)

        duplicate_groups: List[DuplicateGroup] = []

        # Step 2: For sizes with 2 or more files, compute verified SHA-256 hashes
        for size_bytes, candidate_files in size_buckets.items():
            if len(candidate_files) < 2:
                continue

            hash_map: Dict[str, List[Tuple[FileMetadata, DuplicateFileItem]]] = defaultdict(list)

            for candidate in candidate_files:
                resolved_file, resolve_err = self._safe_resolve(
                    canonical_root, candidate.relative_path
                )
                if resolve_err or not resolved_file:
                    skipped_files.append(
                        SkippedEntry(
                            path=candidate.relative_path,
                            reason=resolve_err or "Failed to resolve file path",
                        )
                    )
                    continue

                sha256_hash, hash_err = self._hash_file(resolved_file, candidate.size_bytes)
                if hash_err or not sha256_hash:
                    skipped_files.append(
                        SkippedEntry(
                            path=candidate.relative_path,
                            reason=hash_err or "Hashing failed",
                        )
                    )
                    continue

                item = DuplicateFileItem(
                    filename=candidate.filename,
                    relative_path=candidate.relative_path,
                    size_bytes=candidate.size_bytes,
                    modified_at=candidate.modified_at,
                    category=candidate.category.value if candidate.category else None,
                )
                hash_map[sha256_hash].append((candidate, item))

            # Step 3: Filter hash matches where 2 or more files share identical SHA-256
            for file_hash, matched_entries in hash_map.items():
                if len(matched_entries) >= 2:
                    file_items = [entry[1] for entry in matched_entries]
                    # Sort deterministically by relative path
                    file_items.sort(key=lambda x: x.relative_path)
                    
                    file_count = len(file_items)
                    # Conservative calculation: count only extra copies beyond 1 retained copy
                    reclaimable_bytes = (file_count - 1) * size_bytes

                    group = DuplicateGroup(
                        group_id=f"dup-{file_hash[:12]}",
                        hash=file_hash,
                        size_bytes=size_bytes,
                        file_count=file_count,
                        reclaimable_bytes=reclaimable_bytes,
                        files=file_items,
                    )
                    duplicate_groups.append(group)

        # Sort groups by reclaimable bytes descending (largest savings first), then by size descending
        duplicate_groups.sort(key=lambda g: (g.reclaimable_bytes, g.size_bytes), reverse=True)

        total_groups = len(duplicate_groups)
        total_duplicate_files = sum(g.file_count for g in duplicate_groups)
        total_reclaimable_bytes = sum(g.reclaimable_bytes for g in duplicate_groups)

        response = DuplicateAnalysisResponse(
            scan_id=scan_id,
            target_path=str(canonical_root),
            analyzed_at=analyzed_at,
            total_groups=total_groups,
            total_duplicate_files=total_duplicate_files,
            reclaimable_bytes=total_reclaimable_bytes,
            groups=duplicate_groups,
            skipped_files=skipped_files,
        )

        self._duplicate_cache[scan_id] = response
        return response

    def clear_cache(self, scan_id: Optional[str] = None) -> None:
        """Clear cached duplicate analyses."""
        if scan_id:
            self._duplicate_cache.pop(scan_id, None)
        else:
            self._duplicate_cache.clear()


duplicate_service = DuplicateService()
