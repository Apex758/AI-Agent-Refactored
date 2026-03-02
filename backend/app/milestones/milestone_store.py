"""
Milestone Store — topic → milestones → mastery tracking.
Stored in the same SQLite DB as memory (data/workspace/.memory_index.db).
"""
import json
import time
import sqlite3
from enum import Enum
from dataclasses import dataclass, field, asdict
from typing import Optional, List
from pathlib import Path

from app.core.config import settings
from app.core.logging import logger


class MilestoneStatus(str, Enum):
    LOCKED      = "locked"
    AVAILABLE   = "available"
    IN_PROGRESS = "in_progress"
    CHECKING    = "checking"
    MASTERED    = "mastered"
    NEEDS_REVIEW = "needs_review"


STATUS_EMOJI = {
    MilestoneStatus.MASTERED:     "✅",
    MilestoneStatus.IN_PROGRESS:  "🔵",
    MilestoneStatus.CHECKING:     "🟡",
    MilestoneStatus.AVAILABLE:    "⬜",
    MilestoneStatus.LOCKED:       "🔒",
    MilestoneStatus.NEEDS_REVIEW: "🔴",
}


@dataclass
class Milestone:
    milestone_id: str
    title: str
    description: str
    order: int = 0
    status: MilestoneStatus = MilestoneStatus.AVAILABLE
    attempts: int = 0
    mastery_evidence: list = field(default_factory=list)   # [{correct, ts}]
    started_at: float = 0.0
    completed_at: float = 0.0

    def record_check(self, correct: bool):
        self.attempts += 1
        self.mastery_evidence.append({"correct": correct, "ts": time.time()})
        if len(self.mastery_evidence) > 10:
            self.mastery_evidence = self.mastery_evidence[-10:]

    @property
    def recent_accuracy(self) -> float:
        recent = self.mastery_evidence[-5:]
        if not recent:
            return 0.0
        return sum(1 for e in recent if e["correct"]) / len(recent)

    def check_mastery(self) -> bool:
        return self.attempts >= 2 and self.recent_accuracy >= 0.8

    def to_dict(self) -> dict:
        d = asdict(self)
        d["status"] = self.status.value
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "Milestone":
        d = dict(d)
        d["status"] = MilestoneStatus(d.get("status", "available"))
        fields = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in d.items() if k in fields})


@dataclass
class MilestonePlan:
    plan_id: str
    chat_id: str
    subject: str
    topic: str
    grade_level: str = ""
    milestones: List[Milestone] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)

    @property
    def progress(self) -> float:
        if not self.milestones:
            return 0.0
        return sum(1 for m in self.milestones if m.status == MilestoneStatus.MASTERED) / len(self.milestones)

    def current_milestone(self) -> Optional[Milestone]:
        for m in self.milestones:
            if m.status in (MilestoneStatus.IN_PROGRESS, MilestoneStatus.CHECKING):
                return m
        for m in self.milestones:
            if m.status == MilestoneStatus.AVAILABLE:
                return m
        return None

    def advance(self):
        current = self.current_milestone()
        if current:
            current.status = MilestoneStatus.MASTERED
            current.completed_at = time.time()
        for m in self.milestones:
            if m.status == MilestoneStatus.LOCKED:
                m.status = MilestoneStatus.AVAILABLE
                break

    def get_progress_summary(self) -> str:
        lines = [f"Topic: {self.topic} ({self.progress:.0%} complete)"]
        for m in self.milestones:
            emoji = STATUS_EMOJI[m.status]
            acc = f" ({m.recent_accuracy:.0%})" if m.attempts > 0 else ""
            lines.append(f"  {emoji} {m.order}. {m.title}{acc}")
        return "\n".join(lines)

    def to_dict(self) -> dict:
        return {
            "plan_id": self.plan_id,
            "chat_id": self.chat_id,
            "subject": self.subject,
            "topic": self.topic,
            "grade_level": self.grade_level,
            "milestones": [m.to_dict() for m in self.milestones],
            "created_at": self.created_at,
        }


class MilestoneStore:
    """SQLite-backed milestone storage (shared DB with MemoryManager)."""

    def __init__(self, db_path: str):
        self.db_path = db_path
        self._init_table()

    def _init_table(self):
        conn = sqlite3.connect(self.db_path)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS milestone_plans (
                plan_id     TEXT PRIMARY KEY,
                chat_id     TEXT NOT NULL,
                subject     TEXT NOT NULL,
                topic       TEXT NOT NULL,
                grade_level TEXT DEFAULT '',
                data        TEXT NOT NULL,
                created_at  REAL DEFAULT 0,
                updated_at  REAL DEFAULT 0
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_ms_chat ON milestone_plans(chat_id)")
        conn.commit()
        conn.close()

    def save_plan(self, plan: MilestonePlan):
        conn = sqlite3.connect(self.db_path)
        conn.execute("""
            INSERT INTO milestone_plans (plan_id, chat_id, subject, topic, grade_level, data, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(plan_id) DO UPDATE SET
                data = excluded.data,
                updated_at = excluded.updated_at
        """, (
            plan.plan_id, plan.chat_id, plan.subject, plan.topic,
            plan.grade_level, json.dumps(plan.to_dict()),
            plan.created_at, time.time()
        ))
        conn.commit()
        conn.close()

    def get_plan(self, plan_id: str) -> Optional[MilestonePlan]:
        conn = sqlite3.connect(self.db_path)
        row = conn.execute("SELECT data FROM milestone_plans WHERE plan_id = ?", (plan_id,)).fetchone()
        conn.close()
        return self._parse_row(row[0]) if row else None

    def list_plans_for_chat(self, chat_id: str) -> List[MilestonePlan]:
        conn = sqlite3.connect(self.db_path)
        rows = conn.execute(
            "SELECT data FROM milestone_plans WHERE chat_id = ? ORDER BY created_at DESC",
            (chat_id,)
        ).fetchall()
        conn.close()
        return [self._parse_row(r[0]) for r in rows if r[0]]

    def get_plan_for_topic(self, chat_id: str, topic: str) -> Optional[MilestonePlan]:
        conn = sqlite3.connect(self.db_path)
        row = conn.execute(
            "SELECT data FROM milestone_plans WHERE chat_id = ? AND topic = ? ORDER BY created_at DESC LIMIT 1",
            (chat_id, topic)
        ).fetchone()
        conn.close()
        return self._parse_row(row[0]) if row else None

    def delete_plan(self, plan_id: str):
        conn = sqlite3.connect(self.db_path)
        conn.execute("DELETE FROM milestone_plans WHERE plan_id = ?", (plan_id,))
        conn.commit()
        conn.close()

    def _parse_row(self, data_str: str) -> Optional[MilestonePlan]:
        try:
            d = json.loads(data_str)
            milestones = [Milestone.from_dict(m) for m in d.get("milestones", [])]
            return MilestonePlan(
                plan_id=d["plan_id"],
                chat_id=d.get("chat_id", ""),
                subject=d["subject"],
                topic=d["topic"],
                grade_level=d.get("grade_level", ""),
                milestones=milestones,
                created_at=d.get("created_at", 0),
            )
        except Exception as e:
            logger.warning(f"Failed to parse milestone plan: {e}")
            return None


# Singleton
_store: Optional[MilestoneStore] = None

def get_milestone_store() -> MilestoneStore:
    global _store
    if _store is None:
        db_path = str(Path(settings.memory_workspace) / ".memory_index.db")
        _store = MilestoneStore(db_path)
    return _store
