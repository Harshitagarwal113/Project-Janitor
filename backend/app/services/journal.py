from datetime import datetime, timezone
from pathlib import Path
import sqlite3
from typing import Dict, List, Optional, Tuple

from app.core.config import settings
from app.schemas.operation import (
    ExecutedOperationItem,
    OperationStatus,
    UndoStatus,
)


class OperationJournalService:
    """SQLite-backed persistent operations journal.
    
    Stored strictly in the application's local data directory, NEVER
    inside the user's scanned directory.
    """

    def __init__(self, db_path: Optional[str] = None) -> None:
        self.db_path = self._resolve_db_path(db_path or settings.JOURNAL_DB_PATH)
        self._init_db()

    def _resolve_db_path(self, path_str: str) -> Path:
        """Resolve database path ensuring parent directories exist."""
        p = Path(path_str)
        if not p.is_absolute():
            # Resolve relative to current working directory or project root
            p = Path.cwd() / p
        p.parent.mkdir(parents=True, exist_ok=True)
        return p.resolve()

    def _get_connection(self) -> sqlite3.Connection:
        """Create a sqlite3 connection with row dictionary access."""
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        # Enable WAL mode for high reliability and concurrency
        conn.execute("PRAGMA journal_mode=WAL;")
        return conn

    def _init_db(self) -> None:
        """Initialize SQLite database schema safely."""
        with self._get_connection() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS operations_journal (
                    operation_id TEXT PRIMARY KEY,
                    plan_id TEXT NOT NULL,
                    target_root TEXT NOT NULL,
                    original_path TEXT NOT NULL,
                    destination_path TEXT,
                    operation_type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    error_message TEXT,
                    undo_status TEXT NOT NULL,
                    undo_timestamp TEXT,
                    undo_error TEXT,
                    file_size_bytes INTEGER NOT NULL DEFAULT 0,
                    file_mtime_before REAL
                );
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_plan_id ON operations_journal(plan_id);"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_timestamp ON operations_journal(timestamp);"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_status ON operations_journal(status);"
            )
            conn.commit()

    def record_operation(
        self,
        operation_id: str,
        plan_id: str,
        target_root: str,
        original_path: str,
        destination_path: Optional[str],
        operation_type: str,
        status: OperationStatus,
        undo_status: UndoStatus,
        file_size_bytes: int = 0,
        file_mtime_before: Optional[float] = None,
        error_message: Optional[str] = None,
        timestamp: Optional[str] = None,
    ) -> None:
        """Insert or update a journal record transactionally."""
        ts = timestamp or datetime.now(timezone.utc).isoformat()
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO operations_journal (
                    operation_id, plan_id, target_root, original_path, destination_path,
                    operation_type, status, timestamp, error_message, undo_status,
                    file_size_bytes, file_mtime_before
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    operation_id,
                    plan_id,
                    target_root,
                    original_path,
                    destination_path,
                    operation_type,
                    status.value,
                    ts,
                    error_message,
                    undo_status.value,
                    file_size_bytes,
                    file_mtime_before,
                ),
            )
            conn.commit()

    def get_operation(self, operation_id: str) -> Optional[dict]:
        """Retrieve a single journal record by operation ID."""
        with self._get_connection() as conn:
            cursor = conn.execute(
                "SELECT * FROM operations_journal WHERE operation_id = ?;",
                (operation_id,),
            )
            row = cursor.fetchone()
            if row:
                return dict(row)
        return None

    def list_operations(
        self,
        plan_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> Tuple[int, List[ExecutedOperationItem]]:
        """Query journal records with pagination and optional plan filtering."""
        bounded_limit = max(1, min(limit, 1000))
        bounded_offset = max(0, offset)

        query = "SELECT * FROM operations_journal"
        count_query = "SELECT COUNT(*) FROM operations_journal"
        params: List = []

        if plan_id:
            query += " WHERE plan_id = ?"
            count_query += " WHERE plan_id = ?"
            params.append(plan_id)

        query += " ORDER BY timestamp DESC LIMIT ? OFFSET ?;"
        params_with_paging = list(params) + [bounded_limit, bounded_offset]

        with self._get_connection() as conn:
            total = conn.execute(count_query, params).fetchone()[0]
            cursor = conn.execute(query, params_with_paging)
            rows = cursor.fetchall()

            items = [
                ExecutedOperationItem(
                    operation_id=r["operation_id"],
                    plan_id=r["plan_id"],
                    original_path=r["original_path"],
                    destination_path=r["destination_path"],
                    operation_type=r["operation_type"],
                    status=OperationStatus(r["status"]),
                    error_message=r["error_message"],
                    undo_status=UndoStatus(r["undo_status"]),
                    timestamp=r["timestamp"],
                    file_size_bytes=r["file_size_bytes"],
                )
                for r in rows
            ]

        return total, items

    def get_reversible_operations_for_plan(self, plan_id: str) -> List[dict]:
        """Fetch all completed, reversible operations for a plan in reverse order."""
        with self._get_connection() as conn:
            cursor = conn.execute(
                """
                SELECT * FROM operations_journal
                WHERE plan_id = ? AND status = ? AND undo_status = ?
                ORDER BY timestamp DESC;
                """,
                (plan_id, OperationStatus.COMPLETED.value, UndoStatus.REVERSIBLE.value),
            )
            return [dict(r) for r in cursor.fetchall()]

    def mark_undone(self, operation_id: str) -> None:
        """Mark an operation as successfully undone."""
        ts = datetime.now(timezone.utc).isoformat()
        with self._get_connection() as conn:
            conn.execute(
                """
                UPDATE operations_journal
                SET status = ?, undo_status = ?, undo_timestamp = ?, undo_error = NULL
                WHERE operation_id = ?;
                """,
                (
                    OperationStatus.UNDONE.value,
                    UndoStatus.UNDONE.value,
                    ts,
                    operation_id,
                ),
            )
            conn.commit()

    def mark_undo_blocked(self, operation_id: str, reason: str) -> None:
        """Mark an undo attempt as blocked with reason."""
        with self._get_connection() as conn:
            conn.execute(
                """
                UPDATE operations_journal
                SET undo_status = ?, undo_error = ?
                WHERE operation_id = ?;
                """,
                (UndoStatus.BLOCKED.value, reason, operation_id),
            )
            conn.commit()

    def mark_undo_failed(self, operation_id: str, reason: str) -> None:
        """Mark an undo attempt as failed with reason."""
        with self._get_connection() as conn:
            conn.execute(
                """
                UPDATE operations_journal
                SET undo_status = ?, undo_error = ?
                WHERE operation_id = ?;
                """,
                (UndoStatus.UNREVERSIBLE.value, reason, operation_id),
            )
            conn.commit()


# Global singleton instance of OperationJournalService
operation_journal = OperationJournalService()
