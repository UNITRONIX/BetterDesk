"""Offline tests for the BetterDesk CDAP Python SDK."""

from __future__ import annotations

import asyncio
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from betterdesk_cdap import CDAPBridge, gauge, toggle  # noqa: E402
from betterdesk_cdap.protocol import (  # noqa: E402
    Message,
    auth_payload_api_key,
    auth_payload_device_token,
    auth_payload_user_password,
)


class ProtocolTests(unittest.TestCase):
    def test_message_round_trip(self) -> None:
        original = Message(type="telemetry", payload={"temperature": 21}, id="message-1")
        encoded = original.to_json()
        decoded = Message.from_json(encoded)

        self.assertEqual(decoded.type, "telemetry")
        self.assertEqual(decoded.payload, {"temperature": 21})
        self.assertEqual(decoded.id, "message-1")
        self.assertIsNotNone(decoded.timestamp)
        self.assertEqual(json.loads(encoded)["type"], "telemetry")

    def test_auth_payloads(self) -> None:
        self.assertEqual(
            auth_payload_api_key("key", "device", "2.0.0"),
            {
                "method": "api_key",
                "key": "key",
                "device_id": "device",
                "client_version": "2.0.0",
            },
        )
        self.assertEqual(auth_payload_device_token("token")["method"], "device_token")
        self.assertEqual(auth_payload_user_password("admin", "password")["method"], "user_password")


class BridgeTests(unittest.TestCase):
    def test_widget_defaults_and_manifest(self) -> None:
        bridge = CDAPBridge(
            "ws://127.0.0.1:1/cdap",
            device_id="device-1",
            device_name="Test bridge",
            heartbeat_sec=1,
        )
        bridge.add_widget(gauge("temperature", "Temperature", max_val=50))
        bridge.add_widget(toggle("heater", "Heater"))

        manifest = bridge._build_manifest()
        self.assertEqual(manifest["manifest_version"], "1.0")
        self.assertEqual(manifest["device"]["name"], "Test bridge")
        self.assertEqual(manifest["device"]["type"], "iot")
        self.assertEqual([widget["id"] for widget in manifest["widgets"]], ["temperature", "heater"])
        self.assertEqual(bridge.heartbeat_sec, 5)

    def test_command_handler_success_and_failure(self) -> None:
        async def exercise() -> list[dict]:
            bridge = CDAPBridge("ws://127.0.0.1:1/cdap")
            sent: list[dict] = []

            async def fake_send(message_type: str, payload: dict) -> None:
                sent.append({"type": message_type, "payload": payload})

            bridge._send = fake_send  # type: ignore[method-assign]
            bridge.add_widget(toggle("heater", "Heater"))

            @bridge.on_command("heater")
            async def handle_heater(**kwargs):
                return kwargs["value"]

            await bridge._handle_command(
                {
                    "command_id": "command-1",
                    "widget_id": "heater",
                    "action": "set",
                    "value": True,
                }
            )
            return sent

        sent = asyncio.run(exercise())
        self.assertEqual(sent[0]["type"], "command_response")
        self.assertEqual(sent[0]["payload"]["status"], "ok")
        self.assertTrue(sent[0]["payload"]["result"])


if __name__ == "__main__":
    unittest.main()
