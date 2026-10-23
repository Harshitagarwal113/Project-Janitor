from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Set
import uuid

from app.schemas.ai import AIClassificationRequest
from app.schemas.plan import (
    CleanupPlanItem,
    CleanupPlanRequest,
    CleanupPlanResponse,
    CleanupPlanSummary,
    OrganizationPreferences,
    PlanActionType,
)
from app.schemas.scan import FileCategory, FileMetadata
from app.services.duplicate import duplicate_service
from app.services.ollama import (
    OllamaServiceError,
    ollama_service,
)
from app.services.scanner import ScanRecord, scanner_service

DEFAULT_CATEGORY_FOLDERS: Dict[str, str] = {
    FileCategory.DOCUMENTS.value: "Documents",
    FileCategory.IMAGES.value: "Images",
    FileCategory.VIDEOS.value: "Videos",
    FileCategory.AUDIO.value: "Audio",
    FileCategory.ARCHIVES.value: "Archives",
    FileCategory.CODE.value: "Code",
    FileCategory.OTHER.value: "Other",
}


class CleanupPlanService:
    """Service for generating non-destructive, reviewable filesystem cleanup plans.
    
    SAFETY INVARIANTS:
    1. NEVER executes, deletes, moves, or alters any file.
    2. NEVER overwrites an existing file or plan collision.
    3. NEVER automatically selects duplicate files for deletion (flags for user review only).
    4. REJECTS any destination escaping the authorized scan root.
    5. DETERMINISTIC rules by default; uses local AI only when requested and online.
    """

    def __init__(self) -> None:
        self._plans: Dict[str, CleanupPlanResponse] = {}

    def get_plan(self, plan_id: str) -> Optional[CleanupPlanResponse]:
        """Retrieve a previously generated cleanup plan by ID."""
        return self._plans.get(plan_id)

    def _resolve_collision(
        self,
        canonical_root: Path,
        source_rel_path: str,
        target_folder: str,
        desired_filename: str,
        planned_destinations: Set[str],
    ) -> tuple[str, bool]:
        """Resolve destination naming collisions without ever overwriting.
        
        Checks both existing filesystem items and earlier entries in this plan.
        Returns (resolved_rel_path, has_conflict_flag).
        """
        source_full = (canonical_root / source_rel_path).resolve()
        candidate_filename = desired_filename
        has_conflict = False

        stem = Path(desired_filename).stem
        suffix = Path(desired_filename).suffix

        counter = 1
        while True:
            candidate_rel = (
                f"{target_folder}/{candidate_filename}"
                if target_folder
                else candidate_filename
            )
            candidate_full = (canonical_root / candidate_rel).resolve()

            # Safety check: Prevent directory traversal outside authorized root
            try:
                if not candidate_full.is_relative_to(canonical_root):
                    return source_rel_path, False
            except AttributeError:
                try:
                    candidate_full.relative_to(canonical_root)
                except ValueError:
                    return source_rel_path, False

            # Collision check:
            # 1. Candidate is planned by an earlier file in this same plan
            in_plan = candidate_rel in planned_destinations
            # 2. Candidate already exists on disk and is NOT the file itself
            on_disk = candidate_full.exists() and candidate_full != source_full

            if not in_plan and not on_disk:
                return candidate_rel, has_conflict

            # Collision detected, append numerical suffix to avoid overwrite
            has_conflict = True
            candidate_filename = f"{stem}_{counter}{suffix}"
            counter += 1

    async def generate_plan(
        self, request: CleanupPlanRequest
    ) -> CleanupPlanResponse:
        """Generate a validated, proposed cleanup plan for the given scan.
        
        Uses deterministic category rules and optional local Gemma classification.
        Does NOT modify or move any files on the filesystem.
        """
        scan_record: Optional[ScanRecord] = scanner_service.get_scan(request.scan_id)
        if not scan_record:
            raise KeyError(f"Scan with ID '{request.scan_id}' not found.")

        canonical_root = Path(scan_record.target_path).resolve()
        prefs = request.preferences or OrganizationPreferences()

        # Step 1: Detect duplicate files for flagging if enabled
        # Redundant copies are flagged for user review; never automatically deleted
        duplicate_flags: Dict[str, tuple[str, str, str]] = {}
        if prefs.flag_duplicates:
            dup_analysis = duplicate_service.analyze_duplicates(request.scan_id)
            for group in dup_analysis.groups:
                if len(group.files) >= 2:
                    # Designate first file as the primary/retained copy
                    retained_file = group.files[0]
                    # Flag all other copies as duplicates
                    for dup_file in group.files[1:]:
                        duplicate_flags[dup_file.relative_path] = (
                            group.group_id,
                            group.hash,
                            retained_file.relative_path,
                        )

        # Step 2: Determine local AI availability
        ai_available = False
        if prefs.use_ai:
            try:
                ai_status = await ollama_service.get_service_status()
                ai_available = ai_status.service_available and ai_status.model_installed
            except Exception:
                ai_available = False

        # Category folder mapping
        cat_folders = dict(DEFAULT_CATEGORY_FOLDERS)
        if prefs.custom_category_folders:
            cat_folders.update(prefs.custom_category_folders)

        prefix = prefs.target_folder_prefix.strip().strip("/\\")

        planned_destinations: Set[str] = set()
        plan_items: List[CleanupPlanItem] = []

        moves_count = 0
        renames_count = 0
        skips_count = 0
        duplicates_flagged_count = 0
        ai_suggestions_used_count = 0
        conflicts_resolved_count = 0

        # Step 3: Process each file deterministically
        for idx, file_meta in enumerate(scan_record.files):
            item_id = f"item-{idx + 1}"
            source_rel = file_meta.relative_path

            # Check if flagged as duplicate
            if source_rel in duplicate_flags:
                group_id, group_hash, retained_path = duplicate_flags[source_rel]
                duplicates_flagged_count += 1
                plan_items.append(
                    CleanupPlanItem(
                        item_id=item_id,
                        original_path=source_rel,
                        proposed_path=None,
                        action=PlanActionType.DUPLICATE_FLAG,
                        category=file_meta.category,
                        size_bytes=file_meta.size_bytes,
                        reason=(
                            f"Exact SHA-256 duplicate copy in set {group_id} "
                            f"(hash: {group_hash[:10]}...). Retained copy: '{retained_path}'"
                        ),
                        confidence=1.0,
                        is_ai_suggested=False,
                        has_conflict=False,
                    )
                )
                continue

            target_category = file_meta.category
            desired_filename = file_meta.filename
            is_ai_suggested = False
            confidence = 1.0
            reason = f"Categorized as {file_meta.category.value} based on '{file_meta.extension}' extension."

            # Optional AI Consultation for ambiguous files ("other") or when enabled
            if (
                ai_available
                and prefs.use_ai
                and (
                    target_category == FileCategory.OTHER
                    or file_meta.filename.lower().startswith("untitled")
                    or not file_meta.extension
                )
            ):
                try:
                    # Safe read of small text snippet if text format
                    content_sample: Optional[str] = None
                    if ollama_service.is_text_format(file_meta.extension):
                        full_source = (canonical_root / source_rel).resolve()
                        if (
                            full_source.exists()
                            and full_source.is_file()
                            and full_source.is_relative_to(canonical_root)
                        ):
                            try:
                                with open(full_source, "r", encoding="utf-8", errors="ignore") as fp:
                                    content_sample = fp.read(1500)
                            except Exception:
                                content_sample = None

                    ai_resp = await ollama_service.classify_file(
                        AIClassificationRequest(
                            filename=file_meta.filename,
                            file_content=content_sample,
                            size_bytes=file_meta.size_bytes,
                            extension=file_meta.extension,
                        )
                    )
                    target_category = ai_resp.suggested_category
                    if ai_resp.suggested_filename and ai_resp.suggested_filename.strip():
                        # Sanitize AI suggested filename to prevent directory traversal
                        clean_suggested = Path(ai_resp.suggested_filename).name.strip()
                        if clean_suggested:
                            desired_filename = clean_suggested

                    is_ai_suggested = True
                    confidence = ai_resp.confidence
                    reason = f"AI suggestion: {ai_resp.rationale}"
                    ai_suggestions_used_count += 1
                except (OllamaServiceError, Exception):
                    # Continue with deterministic rules on any AI failure
                    is_ai_suggested = False
                    confidence = 1.0

            # Determine destination category folder
            folder_name = cat_folders.get(target_category.value, "Other")
            dest_folder = f"{prefix}/{folder_name}" if prefix else folder_name

            # Collision resolution and overwrite prevention
            proposed_rel, has_conflict = self._resolve_collision(
                canonical_root=canonical_root,
                source_rel_path=source_rel,
                target_folder=dest_folder,
                desired_filename=desired_filename,
                planned_destinations=planned_destinations,
            )

            if has_conflict:
                conflicts_resolved_count += 1
                reason += " (Destination conflict resolved with numerical suffix to prevent overwrite)"

            # Determine action type
            source_folder = str(Path(source_rel).parent.as_posix())
            if source_folder == ".":
                source_folder = ""

            is_same_path = proposed_rel == source_rel
            is_same_folder = dest_folder == source_folder
            is_same_name = desired_filename == file_meta.filename

            if is_same_path:
                action = PlanActionType.SKIP
                skips_count += 1
                reason = "File is already in the designated folder."
                # Don't reserve destination for skip if it's already there
            elif not is_same_folder and not is_same_name:
                action = PlanActionType.MOVE_AND_RENAME
                moves_count += 1
                renames_count += 1
                planned_destinations.add(proposed_rel)
            elif not is_same_folder:
                action = PlanActionType.MOVE
                moves_count += 1
                planned_destinations.add(proposed_rel)
            elif not is_same_name:
                action = PlanActionType.RENAME
                renames_count += 1
                planned_destinations.add(proposed_rel)
            else:
                action = PlanActionType.SKIP
                skips_count += 1

            plan_items.append(
                CleanupPlanItem(
                    item_id=item_id,
                    original_path=source_rel,
                    proposed_path=proposed_rel if action != PlanActionType.SKIP else None,
                    action=action,
                    category=target_category,
                    size_bytes=file_meta.size_bytes,
                    reason=reason,
                    confidence=confidence,
                    is_ai_suggested=is_ai_suggested,
                    has_conflict=has_conflict,
                )
            )

        summary = CleanupPlanSummary(
            total_files=len(scan_record.files),
            moves=moves_count,
            renames=renames_count,
            skips=skips_count,
            duplicates_flagged=duplicates_flagged_count,
            ai_suggestions_used=ai_suggestions_used_count,
            conflicts_resolved=conflicts_resolved_count,
        )

        plan_id = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc).isoformat()

        response = CleanupPlanResponse(
            plan_id=plan_id,
            scan_id=request.scan_id,
            target_path=str(canonical_root),
            created_at=created_at,
            summary=summary,
            items=plan_items,
        )

        self._plans[plan_id] = response
        return response


# Global singleton instance of CleanupPlanService
cleanup_plan_service = CleanupPlanService()
