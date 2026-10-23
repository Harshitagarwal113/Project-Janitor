import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Set

from app.schemas.scan import (
    FileCategory,
    FileMetadata,
    ScanResponse,
    SkippedEntry,
)
from app.utils.category import classify_extension


@dataclass
class ScanRecord:
    scan_id: str
    target_path: str
    status: str
    scanned_at: str
    total_files: int
    total_scanned_bytes: int
    category_counts: Dict[str, int]
    files: List[FileMetadata] = field(default_factory=list)
    skipped_entries: List[SkippedEntry] = field(default_factory=list)


class ScannerService:
    """Filesystem scanner service with strict path safety and metadata extraction."""

    def __init__(self) -> None:
        # In-memory storage for scan results (no database persistence at this stage)
        self._scans: Dict[str, ScanRecord] = {}

    def validate_target_path(self, raw_path: str) -> Path:
        """Validate and canonicalize target directory path.

        Ensures path:
        1. Is not empty and is explicitly provided.
        2. Is an absolute path.
        3. Exists on the filesystem and is a directory.
        4. Is not an entire drive root (e.g. C:\\ or /).
        """
        if not raw_path or not raw_path.strip():
            raise ValueError("Target path must not be empty.")

        path_obj = Path(raw_path.strip())

        # Enforce explicitly absolute path
        if not path_obj.is_absolute():
            raise ValueError("An explicit absolute directory path is required.")

        # Canonicalize path
        try:
            resolved = path_obj.resolve()
        except OSError as e:
            raise ValueError(f"Unable to resolve path '{raw_path}': {e}")

        # Safety: Prevent scanning entire drive root
        # On Windows: C:\ anchor == resolved path; on Unix: / anchor == resolved path
        if resolved == Path(resolved.anchor) or resolved.parent == resolved:
            raise ValueError("Scanning an entire drive root is not permitted for safety reasons.")

        # Check existence and directory status
        if not resolved.exists():
            raise FileNotFoundError(f"Target directory does not exist: {raw_path}")

        if not resolved.is_dir():
            raise NotADirectoryError(f"Target path is not a directory: {raw_path}")

        return resolved

    def scan(self, target_path_str: str) -> ScanRecord:
        """Perform a safe filesystem scan on the validated target directory."""
        canonical_root = self.validate_target_path(target_path_str)
        scan_id = str(uuid.uuid4())
        scanned_at = datetime.now(timezone.utc).isoformat()

        category_counts: Dict[str, int] = {cat.value: 0 for cat in FileCategory}
        files: List[FileMetadata] = []
        skipped: List[SkippedEntry] = []
        total_scanned_bytes = 0

        # Verify initial directory read access
        try:
            with os.scandir(canonical_root) as it:
                pass
        except PermissionError as e:
            raise PermissionError(f"Permission denied accessing directory: {e}")

        # Iterative stack-based directory traversal (avoids recursion limit)
        stack: List[Path] = [canonical_root]
        visited_dirs: Set[Path] = {canonical_root}

        while stack:
            current_dir = stack.pop()
            try:
                scanner_entries = os.scandir(current_dir)
            except PermissionError as e:
                try:
                    rel = current_dir.relative_to(canonical_root).as_posix() or "."
                except ValueError:
                    rel = current_dir.name
                skipped.append(
                    SkippedEntry(path=rel, reason=f"Access denied to directory: {e}")
                )
                continue
            except OSError as e:
                try:
                    rel = current_dir.relative_to(canonical_root).as_posix() or "."
                except ValueError:
                    rel = current_dir.name
                skipped.append(
                    SkippedEntry(path=rel, reason=f"Error reading directory: {e}")
                )
                continue

            with scanner_entries as entries:
                for entry in entries:
                    try:
                        entry_path = Path(entry.path)

                        # Determine relative path safely
                        try:
                            rel_path = entry_path.relative_to(canonical_root).as_posix()
                        except ValueError:
                            skipped.append(
                                SkippedEntry(
                                    path=entry.name,
                                    reason="Path traversal outside root detected",
                                )
                            )
                            continue

                        # Check symbolic links
                        try:
                            is_symlink = entry.is_symlink()
                        except OSError as e:
                            skipped.append(
                                SkippedEntry(path=rel_path, reason=f"Inaccessible entry: {e}")
                            )
                            continue

                        resolved_entry = entry_path
                        if is_symlink:
                            try:
                                resolved_entry = self._resolve_entry(entry_path)
                            except OSError as e:
                                skipped.append(
                                    SkippedEntry(path=rel_path, reason=f"Broken symbolic link: {e}")
                                )
                                continue

                            # Safety: Never follow symbolic links pointing outside the authorized root
                            try:
                                if not resolved_entry.is_relative_to(canonical_root):
                                    skipped.append(
                                        SkippedEntry(
                                            path=rel_path,
                                            reason="Symbolic link points outside authorized root directory",
                                        )
                                    )
                                    continue
                            except AttributeError:
                                try:
                                    resolved_entry.relative_to(canonical_root)
                                except ValueError:
                                    skipped.append(
                                        SkippedEntry(
                                            path=rel_path,
                                            reason="Symbolic link points outside authorized root directory",
                                        )
                                    )
                                    continue

                        # Check if directory
                        try:
                            is_dir = (
                                entry.is_dir(follow_symlinks=False)
                                if not is_symlink
                                else resolved_entry.is_dir()
                            )
                        except OSError as e:
                            skipped.append(
                                SkippedEntry(path=rel_path, reason=f"Inaccessible entry: {e}")
                            )
                            continue

                        if is_dir:
                            dir_to_visit = (
                                resolved_entry if is_symlink else entry_path.resolve()
                            )
                            if dir_to_visit in visited_dirs:
                                continue  # Avoid directory loop cycles
                            visited_dirs.add(dir_to_visit)
                            stack.append(dir_to_visit)
                            continue

                        # Check if regular file
                        try:
                            is_file = (
                                entry.is_file(follow_symlinks=False)
                                if not is_symlink
                                else resolved_entry.is_file()
                            )
                        except OSError as e:
                            skipped.append(
                                SkippedEntry(path=rel_path, reason=f"Inaccessible entry: {e}")
                            )
                            continue

                        if is_file:
                            try:
                                # Read ONLY file metadata via stat, never read file contents
                                stat_res = entry.stat(follow_symlinks=True)
                                size = stat_res.st_size
                                mtime_dt = datetime.fromtimestamp(
                                    stat_res.st_mtime, tz=timezone.utc
                                )
                                ext = entry_path.suffix.lower()
                                category = classify_extension(ext)

                                files.append(
                                    FileMetadata(
                                        filename=entry.name,
                                        relative_path=rel_path,
                                        extension=ext,
                                        size_bytes=size,
                                        modified_at=mtime_dt.isoformat(),
                                        category=category,
                                    )
                                )
                                category_counts[category.value] += 1
                                total_scanned_bytes += size
                            except OSError as e:
                                skipped.append(
                                    SkippedEntry(
                                        path=rel_path,
                                        reason=f"Inaccessible file metadata: {e}",
                                    )
                                )
                                continue
                        else:
                            skipped.append(
                                SkippedEntry(
                                    path=rel_path, reason="Unsupported or special file type"
                                )
                            )

                    except Exception as e:
                        skipped.append(
                            SkippedEntry(path=entry.name, reason=f"Error scanning entry: {e}")
                        )

        # Deterministic sorting by relative path
        files.sort(key=lambda f: f.relative_path)

        record = ScanRecord(
            scan_id=scan_id,
            target_path=str(canonical_root),
            status="completed",
            scanned_at=scanned_at,
            total_files=len(files),
            total_scanned_bytes=total_scanned_bytes,
            category_counts=category_counts,
            files=files,
            skipped_entries=skipped,
        )

        self._scans[scan_id] = record
        return record

    def _resolve_entry(self, entry_path: Path) -> Path:
        """Resolve an entry path, canonicalizing symbolic links."""
        return entry_path.resolve()

    def get_scan(self, scan_id: str) -> Optional[ScanRecord]:
        """Retrieve a stored scan record by its unique identifier."""
        return self._scans.get(scan_id)

    def paginate(self, record: ScanRecord, limit: int, offset: int) -> ScanResponse:
        """Create a bounded/paginated response from a ScanRecord."""
        bounded_limit = max(1, limit)
        bounded_offset = max(0, offset)

        sliced_files = record.files[bounded_offset : bounded_offset + bounded_limit]
        has_more = (bounded_offset + bounded_limit) < record.total_files

        return ScanResponse(
            scan_id=record.scan_id,
            target_path=record.target_path,
            status=record.status,
            scanned_at=record.scanned_at,
            total_files=record.total_files,
            total_scanned_bytes=record.total_scanned_bytes,
            category_counts=record.category_counts,
            files=sliced_files,
            skipped_entries=record.skipped_entries,
            limit=bounded_limit,
            offset=bounded_offset,
            has_more=has_more,
        )


# Global singleton instance of ScannerService
scanner_service = ScannerService()
