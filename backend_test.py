#!/usr/bin/env python3

import requests
import sys
import uuid
import json
import websocket
import threading
import time
from datetime import datetime

class WorkBoardsAPITester:
    def __init__(self, base_url="https://86d9fd41-fe94-4ac1-8b21-3c10dab0672c.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_base = f"{base_url}/api"
        self.workspace_id = str(uuid.uuid4())
        self.user_id = str(uuid.uuid4())
        self.headers = {
            'Content-Type': 'application/json',
            'X-Workspace-Id': self.workspace_id,
            'X-User-Id': self.user_id
        }
        self.tests_run = 0
        self.tests_passed = 0
        self.board_id = None
        self.first_group_id = None
        self.created_item_id = None
        self.ws_events = []

    def log_test(self, name, success, details=""):
        """Log test results"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name} - PASSED {details}")
        else:
            print(f"❌ {name} - FAILED {details}")
        return success

    def test_bootstrap(self):
        """Test GET /api/bootstrap - should return workspace with boards and groups"""
        print(f"\n🔍 Testing Bootstrap API...")
        print(f"Using Workspace-Id: {self.workspace_id}")
        print(f"Using User-Id: {self.user_id}")
        
        try:
            response = requests.get(f"{self.api_base}/bootstrap", headers=self.headers, timeout=10)
            
            if response.status_code != 200:
                return self.log_test("Bootstrap", False, f"Status: {response.status_code}, Response: {response.text}")
            
            data = response.json()
            
            # Check structure
            if 'workspaceId' not in data or 'boards' not in data:
                return self.log_test("Bootstrap", False, "Missing workspaceId or boards in response")
            
            boards = data['boards']
            if len(boards) < 1:
                return self.log_test("Bootstrap", False, "Expected at least 1 board")
            
            # Get first board and check groups
            first_board = boards[0]
            self.board_id = first_board['id']
            
            if 'groups' not in first_board or len(first_board['groups']) < 3:
                return self.log_test("Bootstrap", False, f"Expected at least 3 groups, got {len(first_board.get('groups', []))}")
            
            self.first_group_id = first_board['groups'][0]['id']
            
            return self.log_test("Bootstrap", True, f"Found {len(boards)} boards, first board has {len(first_board['groups'])} groups")
            
        except Exception as e:
            return self.log_test("Bootstrap", False, f"Exception: {str(e)}")

    def test_list_items(self):
        """Test GET /api/boards/{boardId}/items"""
        print(f"\n🔍 Testing List Items API...")
        
        if not self.board_id:
            return self.log_test("List Items", False, "No board_id available from bootstrap")
        
        try:
            response = requests.get(f"{self.api_base}/boards/{self.board_id}/items", headers=self.headers, timeout=10)
            
            if response.status_code != 200:
                return self.log_test("List Items", False, f"Status: {response.status_code}, Response: {response.text}")
            
            items = response.json()
            if not isinstance(items, list):
                return self.log_test("List Items", False, "Response is not an array")
            
            return self.log_test("List Items", True, f"Found {len(items)} items")
            
        except Exception as e:
            return self.log_test("List Items", False, f"Exception: {str(e)}")

    def test_create_item(self):
        """Test POST /api/boards/{boardId}/items"""
        print(f"\n🔍 Testing Create Item API...")
        
        if not self.board_id or not self.first_group_id:
            return self.log_test("Create Item", False, "Missing board_id or group_id")
        
        try:
            item_data = {
                "name": "Auto Smoke",
                "groupId": self.first_group_id,
                "order": 999
            }
            
            response = requests.post(
                f"{self.api_base}/boards/{self.board_id}/items", 
                headers=self.headers, 
                json=item_data,
                timeout=10
            )
            
            if response.status_code != 200:
                return self.log_test("Create Item", False, f"Status: {response.status_code}, Response: {response.text}")
            
            created_item = response.json()
            
            # Validate response structure
            required_fields = ['id', 'name', 'groupId', 'boardId']
            for field in required_fields:
                if field not in created_item:
                    return self.log_test("Create Item", False, f"Missing field '{field}' in response")
            
            if created_item['name'] != "Auto Smoke":
                return self.log_test("Create Item", False, f"Name mismatch: expected 'Auto Smoke', got '{created_item['name']}'")
            
            self.created_item_id = created_item['id']
            
            return self.log_test("Create Item", True, f"Created item with ID: {self.created_item_id}")
            
        except Exception as e:
            return self.log_test("Create Item", False, f"Exception: {str(e)}")

    def test_update_item(self):
        """Test PATCH /api/items/{id} - update status to 'Doing'"""
        print(f"\n🔍 Testing Update Item API...")
        
        if not self.created_item_id:
            return self.log_test("Update Item", False, "No created_item_id available")
        
        try:
            update_data = {"status": "Doing"}
            
            response = requests.patch(
                f"{self.api_base}/items/{self.created_item_id}",
                headers=self.headers,
                json=update_data,
                timeout=10
            )
            
            if response.status_code != 200:
                return self.log_test("Update Item", False, f"Status: {response.status_code}, Response: {response.text}")
            
            updated_item = response.json()
            
            if updated_item.get('status') != 'Doing':
                return self.log_test("Update Item", False, f"Status not updated: expected 'Doing', got '{updated_item.get('status')}'")
            
            return self.log_test("Update Item", True, f"Status updated to 'Doing'")
            
        except Exception as e:
            return self.log_test("Update Item", False, f"Exception: {str(e)}")

    def test_websocket_realtime(self):
        """Test WebSocket connection and realtime events"""
        print(f"\n🔍 Testing WebSocket Realtime...")
        
        if not self.board_id:
            return self.log_test("WebSocket", False, "No board_id available")
        
        try:
            # Convert HTTP URL to WebSocket URL
            ws_url = self.base_url.replace('https://', 'wss://').replace('http://', 'ws://')
            ws_endpoint = f"{ws_url}/api/ws/boards/{self.board_id}"
            
            print(f"Connecting to WebSocket: {ws_endpoint}")
            
            # WebSocket event handler
            def on_message(ws, message):
                try:
                    event = json.loads(message)
                    self.ws_events.append(event)
                    print(f"📨 WebSocket event: {event.get('type', 'unknown')}")
                except:
                    pass
            
            def on_error(ws, error):
                print(f"WebSocket error: {error}")
            
            def on_close(ws, close_status_code, close_msg):
                print("WebSocket connection closed")
            
            # Create WebSocket connection
            ws = websocket.WebSocketApp(
                ws_endpoint,
                on_message=on_message,
                on_error=on_error,
                on_close=on_close
            )
            
            # Start WebSocket in a separate thread
            ws_thread = threading.Thread(target=ws.run_forever)
            ws_thread.daemon = True
            ws_thread.start()
            
            # Wait a bit for connection
            time.sleep(2)
            
            # Create a new item to trigger WebSocket event
            test_item_data = {
                "name": "WebSocket Test Item",
                "groupId": self.first_group_id,
                "order": 1000
            }
            
            response = requests.post(
                f"{self.api_base}/boards/{self.board_id}/items",
                headers=self.headers,
                json=test_item_data,
                timeout=10
            )
            
            if response.status_code == 200:
                test_item = response.json()
                
                # Wait for WebSocket event
                time.sleep(2)
                
                # Update the item to trigger another event
                requests.patch(
                    f"{self.api_base}/items/{test_item['id']}",
                    headers=self.headers,
                    json={"status": "Done"},
                    timeout=10
                )
                
                # Wait for update event
                time.sleep(2)
            
            ws.close()
            
            # Check if we received any events
            if len(self.ws_events) > 0:
                event_types = [event.get('type') for event in self.ws_events]
                return self.log_test("WebSocket", True, f"Received {len(self.ws_events)} events: {event_types}")
            else:
                return self.log_test("WebSocket", False, "No WebSocket events received")
                
        except Exception as e:
            return self.log_test("WebSocket", False, f"Exception: {str(e)}")

    def run_focused_smoke_tests(self):
        """Run focused smoke tests as requested"""
        print("🚀 Starting Focused WorkBoards API Smoke Tests")
        print(f"Target URL: {self.base_url}")
        print("=" * 60)
        
        # Run only the requested tests
        bootstrap_ok = self.test_bootstrap()
        if not bootstrap_ok:
            print("❌ Bootstrap failed - stopping tests")
            return 1
            
        create_ok = self.test_create_item()
        update_ok = self.test_update_item()
        
        # Skip websocket test as requested due to missing wsproto
        print("\n🔍 Skipping WebSocket test (backend lacks wsproto as requested)")
        
        # Print summary
        print("\n" + "=" * 60)
        print(f"📊 Focused Test Results: {self.tests_passed}/{self.tests_run} tests passed")
        
        if bootstrap_ok and create_ok and update_ok:
            print("🎉 All focused smoke tests PASSED!")
            return 0
        else:
            print("💥 Some focused smoke tests FAILED!")
            return 1

def main():
    tester = WorkBoardsAPITester()
    return tester.run_all_tests()

if __name__ == "__main__":
    sys.exit(main())