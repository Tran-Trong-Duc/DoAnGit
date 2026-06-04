# Smart Garden Enterprise

Hệ thống quản lý vườn công nghệ cao tích hợp IoT: Ứng dụng web giám sát và điều khiển vườn thông minh theo thời gian thực.

## Tính năng chính

- **Giám sát môi trường** - 6 cảm biến: nhiệt độ, độ ẩm, ánh sáng, khí độc, lửa
- **Điều khiển thiết bị** - Bơm tưới, quạt, phun sương, còi PCCC
- **Tự động hóa** - 5 ngưỡng thiết lập cho chế độ tự động theo ngưỡng cảm biến
- **Cảnh báo thông minh** - Phát hiện vượt ngưỡng và nguy cơ cháy
- **Trợ lý AI** - Tích hợp Gemini hỗ trợ chăm sóc cây trồng
- **Báo cáo** - Xuất Excel dữ liệu cảm biến và lịch sử

**Tech Stack:** Node.js | Express.js | MySQL | HiveMQ Cloud | ESP32

## Hình ảnh

Trang đăng nhập

<img width="858" height="682" alt="image" src="https://github.com/user-attachments/assets/4c350df8-ff8f-4343-88a2-0d0ba595c9d5" />

Trang tổng quan

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/bf4ae4c3-fa35-4f01-97b2-119be782cd01" />

Trang điều khiển hệ thống

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/911272c3-e4cd-43fd-bb03-59b4d7c68451" />

Trang điều khiển tự động

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/29c2b80a-2672-4520-a08b-72797a81135c" />

Trang quản lý cây trồng

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/f19d4c14-91c0-4f49-b762-4065932c20fd" />

Trang ChatBot

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/50f08c1f-24c7-4b2e-9ba7-1f36454701a7" />

Trang cảnh báo

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/4a3a1e9b-22e3-4913-9d5e-2a9320ed040c" />

---

## Cách chạy

### 1. Cài đặt Node.js và MySQL

Đảm bảo máy tính đã cài:
- **Node.js** (phiên bản 18+)
- **MySQL** (phiên bản 8+)

### 2. Tạo cơ sở dữ liệu MySQL

Đăng nhập MySQL và chạy:

```sql
CREATE DATABASE IF NOT EXISTS iot_garden CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Sau đó chạy các file SQL trong thư mục `db/` (thứ tự theo số đầu tiên trong tên file):

```bash
mysql -u root -p iot_garden < db/1_*.sql
mysql -u root -p iot_garden < db/2_*.sql
mysql -u root -p iot_garden < db/3_*.sql
```

### 3. Cấu hình file .env

Tạo file `.env` cùng cấp với `package.json`, copy nội dung từ file `.env.example` và điền các giá trị:

```env
# Gemini API cho ChatBot (tùy chọn - nếu không có, ChatBot sẽ dùng dữ liệu từ MySQL)
GEMINI_API_KEY=YOUR_GEMINI_API_KEY_HERE

# MySQL database
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=123456
DB_NAME=iot_garden
```

### 4. Cài đặt và chạy server

```bash
# Cài đặt dependencies
npm install

# Chạy server
npm start
```

Server sẽ chạy tại `http://localhost:3000`

### 5. Kết nối thiết bị ESP32 qua MQTT

Hệ thống sử dụng **HiveMQ Cloud** làm MQTT Broker.

#### MQTT Topics

| Mục đích | Topic | Chiều |
|----------|-------|--------|
| Gửi dữ liệu cảm biến | `sensor` | ESP32 → Server |
| Lệnh bơm tưới | `garden/pump/set` | Server → ESP32 |
| Lệnh quạt | `garden/fan/set` | Server → ESP32 |
| Lệnh phun sương | `garden/spray/set` | Server → ESP32 |

#### Format dữ liệu cảm biến (ESP32 gửi lên topic `sensor`)

```json
{
  "temperature": 28.5,
  "humidity": 65,
  "soil_moisture": 45,
  "light": 800,
  "gas": 150,
  "flame": 0
}
```

#### Format lệnh điều khiển (Server gửi xuống ESP32)

```json
{
  "id": "cmd-1234567890-123456",
  "device": "irrigation",
  "state": "on",
  "action": "irrigation_on",
  "mode": "manual",
  "requested_at": "2026-06-04T21:00:00.000Z"
}
```

#### Ví dụ code ESP32 (Arduino)

file "SETUP_WIFI_ESP32.ino"  - file sử dụng để nạp code cho esp32

### 6. Tắt chế độ mô phỏng cảm biến

Sau khi có thiết bị thật kết nối, vào **Dashboard** → trượt  xuống tắt **"Bật mô phỏng"** để sử dụng dữ liệu từ ESP32.

---

## Cấu trúc thư mục

```
smart_garden_enterprise_full/
├── Server/              # Backend Node.js
│   └── index.js        # Server chính
├── public/              # Frontend
│   ├── app.html        # Giao diện web
│   ├── app.js          # JavaScript
│   └── style.css       # Styles
├── chatBot/             # ChatBot AI
├── db/                  # Cơ sở dữ liệu SQL
├── node_modules/        # Dependencies
├── .env                 # Cấu hình (tạo tay)
├── .env.example         # Mẫu cấu hình
└── package.json        # NPM config
```

---

## MQTT Broker

Hệ thống sử dụng **HiveMQ Cloud** (miễn phí). Thông tin kết nối đã được cấu hình sẵn trong code.

Nếu muốn sử dụng broker khác, chỉnh sửa phần MQTT trong `Server/index.js`:

```javascript
const client = mqtt.connect(
  "mqtts://YOUR_BROKER_URL:8883",
  {
    username: "YOUR_USERNAME",
    password: "YOUR_PASSWORD",
    reconnectPeriod: 5000,
  }
);
```
