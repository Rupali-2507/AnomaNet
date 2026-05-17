"""
ml/modules/profile_mismatch/__init__.py

Exports the public interface for the profile_mismatch module.

Imported by interfaces.py:
    from modules.profile_mismatch.inference import score as _real_pm_score

Owner: Rupali
"""

from modules.profile_mismatch.inference import score

__all__ = ["score"]