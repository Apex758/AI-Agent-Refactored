"""Logging configuration."""
import sys
import logging

def setup_logging(debug: bool = False):
    level = logging.DEBUG if debug else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)-8s | %(name)s - %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)]
    )
    return logging.getLogger("agent")

logger = setup_logging()
