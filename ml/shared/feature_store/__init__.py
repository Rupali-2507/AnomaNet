"""
ml/shared/feature_store/__init__.py

Exports the public interface for the feature store.

Imported by:
    interfaces.py:
        from shared.feature_store.redis_store import get_rolling_features

    Kafka consumer (Muskan):
        from shared.feature_store import set_transaction

Owner: Rupali
"""

from shared.feature_store.redis_store import get_rolling_features, set_transaction

__all__ = ["get_rolling_features", "set_transaction"]