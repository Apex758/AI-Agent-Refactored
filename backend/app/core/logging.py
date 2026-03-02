"""Logging configuration."""
import sys
import logging

def setup_logging(debug: bool = False):
    level = logging.DEBUG if debug else logging.INFO
    # Use UTF-8 encoding for logs to handle special characters
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter("%(asctime)s | %(levelname)-8s | %(name)s - %(message)s")
    )
    handler.encoding = "utf-8"
    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)-8s | %(name)s - %(message)s",
        handlers=[handler]
    )
    return logging.getLogger("agent")

logger = setup_logging()
