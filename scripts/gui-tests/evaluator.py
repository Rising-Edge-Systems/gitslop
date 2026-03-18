"""
AI Screenshot Evaluator for GitSlop GUI Tests.

Provides screenshot evaluation infrastructure. Currently returns 'needs_review'
verdicts — the real AI evaluation happens when Claude reads the structured
JSON report and screenshots during a review session.

The evaluate() function structures screenshot data with criteria metadata
for programmatic parsing. Baseline screenshots are saved on first run to
enable future pixel-diff regression testing.
"""

import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


# Baselines directory alongside framework.py
BASELINES_DIR = Path(__file__).resolve().parent / 'baselines'


@dataclass
class ScreenshotEvaluation:
    """Result of evaluating a single screenshot against criteria."""
    screenshot_path: str
    criteria: str
    verdict: str  # 'pass', 'fail', 'needs_review'
    notes: str = ''
    baseline_path: Optional[str] = None


def evaluate(screenshot_path: str, criteria_text: str) -> ScreenshotEvaluation:
    """Evaluate a screenshot against the given criteria.

    Currently returns 'needs_review' as a placeholder. The real AI evaluation
    happens when Claude reads the structured report and screenshots.

    Args:
        screenshot_path: Path to the screenshot image file.
        criteria_text: Human-readable criteria describing what should be visible.

    Returns:
        ScreenshotEvaluation with verdict='needs_review'.
    """
    return ScreenshotEvaluation(
        screenshot_path=screenshot_path,
        criteria=criteria_text,
        verdict='needs_review',
        notes='Awaiting AI evaluation — review screenshot against criteria.',
    )


def save_baseline(screenshot_path: str, test_name: str, screenshot_name: str) -> str:
    """Save a screenshot as a baseline reference image.

    On first run, copies the screenshot to baselines/{test_name}/.
    On subsequent runs, the existing baseline is preserved (not overwritten).

    Args:
        screenshot_path: Path to the screenshot to save as baseline.
        test_name: Name of the test (used as subdirectory).
        screenshot_name: Descriptive name for the baseline image.

    Returns:
        Path to the baseline image.
    """
    baseline_dir = BASELINES_DIR / test_name
    baseline_dir.mkdir(parents=True, exist_ok=True)

    baseline_filename = f"{screenshot_name}.png"
    baseline_path = baseline_dir / baseline_filename

    if not baseline_path.exists():
        shutil.copy2(screenshot_path, str(baseline_path))

    return str(baseline_path)


def evaluation_to_dict(evaluation: ScreenshotEvaluation) -> dict:
    """Convert a ScreenshotEvaluation to a dictionary for JSON serialization.

    Args:
        evaluation: The evaluation to convert.

    Returns:
        Dictionary suitable for inclusion in the JSON report.
    """
    result = {
        'path': evaluation.screenshot_path,
        'criteria': evaluation.criteria,
        'verdict': evaluation.verdict,
        'notes': evaluation.notes,
    }
    if evaluation.baseline_path:
        result['baseline_path'] = evaluation.baseline_path
    return result
