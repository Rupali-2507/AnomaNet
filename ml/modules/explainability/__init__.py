"""
ml/modules/explainability/__init__.py

Exports the public interface for the explainability module.

Muskan imports:
    from modules.explainability import explain_router, get_explanation

interfaces.py imports:
    from modules.explainability.generator import get_explanation

Owner: Rupali
"""

from modules.explainability.generator import get_explanation
from modules.explainability.router import explain_router

__all__ = ["explain_router", "get_explanation"]