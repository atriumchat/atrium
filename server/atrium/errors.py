"""Errors the web client can translate: a stable `code` (and `params` for the numbers in the text) travels next to
the Russian text. Old clients keep reading `detail` / `error`; new ones look the code up in their own dictionary."""

from fastapi import HTTPException


class ApiError(HTTPException):
    def __init__(self, status_code: int, code: str, text: str, **params):
        super().__init__(status_code=status_code, detail=text)
        self.code = code
        self.params = params


class Rejected(ValueError):
    """A socket payload that can't be accepted; str() is the Russian text, `code` the translatable reason."""

    def __init__(self, code: str, text: str, **params):
        super().__init__(text)
        self.code = code
        self.params = params


def socket_error(code: str, text: str, **params) -> dict:
    """The ack of a failed socket event."""
    return {"ok": False, "error": text, "code": code, **({"params": params} if params else {})}


def socket_rejected(e: Rejected) -> dict:
    return socket_error(e.code, str(e), **e.params)
