# ChessAssistant

Bộ công cụ hỗ trợ học cờ vua trên chess.com, gồm extension Chrome hiển thị nước đi tối ưu khi giữ phím tắt.

## Thành phần

- [`chess-move-hint/`](chess-move-hint/README.md) — Extension Chrome Manifest V3: giữ phím tắt (mặc định `Ctrl + Q`) để hiện nước đi tốt nhất (SAN) + eval + độ sâu ở góc màn hình. Stockfish chạy hoàn toàn trong trình duyệt, không gửi dữ liệu đi đâu.
- [`tests/`](tests/) — Script Playwright kiểm thử extension trên chess.com/analysis.

## Cài đặt nhanh

1. Mở `chrome://extensions`, bật **Developer mode**.
2. **Load unpacked** → chọn thư mục `chess-move-hint/`.
3. Vào `https://www.chess.com/play/...` hoặc `/analysis` → giữ `Ctrl + Q` để xem nước đi.

Chi tiết: xem [README của extension](chess-move-hint/README.md).

## Cảnh báo

> Chỉ dùng để học và phân tích (ví dụ `/analysis`). Sử dụng trong ván rated trên chess.com vi phạm [Fair Play](https://www.chess.com/legal/fair-play) của họ và có thể bị khóa tài khoản.

## Chạy test

```powershell
cd tests
npm install playwright
npx playwright install chromium
node test.mjs
```

Lưu ý: phải dùng Chromium build của Playwright (Google Chrome bỏ qua `--load-extension`).

## Giấy phép

- Code extension: MIT
- Stockfish: GPL-3.0 (https://stockfishchess.org)
- chess.js: BSD-3-Clause (https://github.com/jhlywa/chess.js)
