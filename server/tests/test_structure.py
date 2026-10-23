"""Categories of channels, and a server's structure brought over from a Discord template. Run: .venv/bin/pytest"""

import pytest

from atrium import discord_import

PASSWORD = "correct horse battery"


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def admin(client):
    r = client.post("/api/setup", json={"code": "friends", "serverName": "Тест", "name": "Админ", "password": PASSWORD})
    if r.status_code == 409:  # another test file set the server up first, with the same admin
        r = client.post("/api/login", json={"name": "Админ", "password": PASSWORD})
    assert r.status_code == 200, r.text
    return bearer(r.json()["token"])


def layout(client, admin):
    data = client.get("/api/bootstrap", headers=admin).json()
    return data["categories"], data["channels"]


def test_category_holds_channels_and_gives_them_back(client, admin):
    cats = client.post("/api/categories", json={"name": "  Игры  "}, headers=admin).json()
    games = next(c for c in cats if c["name"] == "Игры")
    channels = client.post("/api/channels", json={"name": "Dota", "kind": "text", "categoryId": games["id"]}, headers=admin).json()
    dota = next(c for c in channels if c["name"] == "dota")
    assert dota["categoryId"] == games["id"]
    room = next(c for c in client.post("/api/channels", json={"name": "Пати", "kind": "voice"}, headers=admin).json() if c["name"] == "Пати")
    assert room["categoryId"] is None

    moved = client.put(f"/api/channels/{room['id']}/category", json={"categoryId": games["id"]}, headers=admin).json()
    assert next(c for c in moved if c["id"] == room["id"])["categoryId"] == games["id"]

    # Dragging orders one kind within one category: the voice room alone there can't be moved among text channels.
    assert client.put("/api/channels/order", json={"ids": [dota["id"], room["id"]]}, headers=admin).status_code == 400

    assert client.patch(f"/api/categories/{games['id']}", json={"name": "Игры и всё"}, headers=admin).status_code == 200
    assert client.delete(f"/api/categories/{games['id']}", headers=admin).status_code == 200
    cats, channels = layout(client, admin)
    assert games["id"] not in [c["id"] for c in cats]
    assert {c["id"]: c["categoryId"] for c in channels}[dota["id"]] is None


def test_unknown_category_and_not_admin(client, admin):
    assert client.post("/api/channels", json={"name": "x", "kind": "text", "categoryId": "nope"}, headers=admin).status_code == 404
    assert client.post("/api/categories", json={"name": "A"}).status_code == 401


TEMPLATE = {
    "name": "Друзья",
    "serialized_source_guild": {
        "name": "Друзья",
        "roles": [{"name": "@everyone"}, {"name": "Модер"}, {"name": "Бот"}],
        "channels": [
            {"id": 1, "type": 4, "name": "Текст", "position": 0, "parent_id": None},
            {"id": 2, "type": 0, "name": "general", "position": 0, "parent_id": 1},
            {"id": 3, "type": 15, "name": "Форум идей", "position": 1, "parent_id": 1},
            {"id": 4, "type": 4, "name": "Голос", "position": 1, "parent_id": None},
            {"id": 5, "type": 2, "name": "Лобби", "position": 0, "parent_id": 4},
            {"id": 6, "type": 13, "name": "Сцена", "position": 1, "parent_id": 4},
            {"id": 7, "type": 0, "name": "правила", "position": 0, "parent_id": None},
            {"id": 8, "type": 99, "name": "непонятное", "position": 2, "parent_id": None},
        ],
    },
}


def test_template_link_forms():
    for link in ("https://discord.new/AbCdEf123", "discord.new/AbCdEf123", "https://discord.com/template/AbCdEf123", "AbCdEf123"):
        assert discord_import.template_code(link) == "AbCdEf123"


def test_preview_and_import(client, admin, monkeypatch):
    monkeypatch.setattr(discord_import, "fetch_template", lambda code: TEMPLATE)
    found = client.post("/api/import/discord/preview", json={"link": "https://discord.new/AbCdEf123"}, headers=admin).json()
    assert found["roles"] == 2
    assert [c["name"] for c in found["loose"]] == ["правила"]
    assert [(c["name"], [(x["name"], x["kind"]) for x in c["channels"]]) for c in found["categories"]] == [
        ("Текст", [("general", "text"), ("Форум идей", "text")]),
        ("Голос", [("Лобби", "voice"), ("Сцена", "voice")]),
    ]

    before = len(layout(client, admin)[1])
    done = client.post("/api/import/discord", json={"link": "AbCdEf123", "skip": ["h6"]}, headers=admin).json()
    assert done["added"] == 4 and done["removed"] == 0
    cats, channels = layout(client, admin)
    by_name = {c["name"]: c for c in channels}
    text = next(c for c in cats if c["name"] == "Текст")
    assert by_name["general"]["categoryId"] == text["id"]
    assert by_name["форум-идей"]["kind"] == "text"
    assert "Сцена" not in by_name and len(channels) == before + 4
