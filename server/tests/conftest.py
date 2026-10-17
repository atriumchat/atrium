import os
import sys
import tempfile
from pathlib import Path

# The server reads its settings when gomex.config is first imported, so the throwaway data folder is set up before that.
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="gomex-test-")
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi.testclient import TestClient

from gomex import auth


@pytest.fixture(scope="session")
def client():
    from app import app

    return TestClient(app)


@pytest.fixture(autouse=True)
def fresh_rate_limits():
    """Every limit counts per process; one test's tries mustn't lock the next one out."""
    for value in vars(auth).values():
        if isinstance(value, auth.RateLimit):
            value.hits.clear()
