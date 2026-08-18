# Chess Move Hint — Chrome Extension

Extension Chrome Manifest V3 giúp bạn xem **nước đi tối ưu** trên chess.com bằng cách **giữ phím tắt** (mặc định `Ctrl + Q`).

- **Giữ** phím tắt → ô nhỏ góc phải trên cùng hiện nước đi tốt nhất (SAN: `e4`, `Nf3`, `O-O`, `Qxd5+`, ...).
- **Thả** phím tắt → ô biến mất ngay.

Engine Stockfish (asm.js) chạy **hoàn toàn trong trình duyệt**, không gửi nước đi đi đâu cả. Kết quả cache theo thế cờ nên lần bấm sau là tức thì.

## Cài đặt

1. Mở Chrome, vào `chrome://extensions`.
2. Bật **Developer mode** (góc phải trên cùng).
3. Bấm **Load unpacked** → chọn thư mục `chess-move-hint` của repo này.
4. Extension xuất hiện trong thanh công cụ (biểu tượng ♞).

Lần đầu vào `https://www.chess.com/play/...` (live game, /analysis, /play/computer...) extension tự khởi động engine.

## Cách dùng

1. Mở ván cờ trên chess.com.
2. **Giữ `Ctrl + Q` (hoặc phím đã đặt)** → ô góc phải hiện nước đi tốt nhất + số đánh giá (eval) + độ sâu.
3. **Thả phím** → ô biến mất.

### Đổi phím tắt

- Click biểu tượng extension trên thanh công cụ (♞), hoặc vào `chrome://extensions` → Details → **Extension options**.
- Bấm ô "Bấm tổ hợp phím..." → bấm tổ hợp mong muốn (cần ít nhất 1 phím bổ trợ Ctrl/Alt/Shift/Cmd).
- Bấm **Lưu phím tắt** → tải lại (`F5`) trang chess.com.

### Tránh các phím tắt Chrome đã chiếm

Tránh `Ctrl+W`, `Ctrl+T`, `Ctrl+H`, `Ctrl+Shift+Q`, ... Trên macOS tránh `Ctrl+Q` (thoát Chrome) — hãy dùng `Cmd+Q` hoặc `Cmd+Shift+Q`.

## Cảnh báo quan trọng

> Sử dụng tool này trong **ván xếp hạng** (rated) trên chess.com vi phạm [Fair Play](https://www.chess.com/legal/fair-play) của họ và có thể bị khóa tài khoản. Chỉ dùng cho việc học, phân tích, hoặc trên `/analysis`.

## Hoạt động nội bộ

```
┌──────────────────┐      ┌───────────────────────┐
│ fen-bridge.js    │      │ Worker (Stockfish)    │
│  (MAIN world)    │      │  • phân tích UCI       │
│  • game.getFEN() │      │  • depth 18, ≤900ms    │
│  • data-cc-hint- │ ───► │                       │
│    fen attribute │  ◄── │                       │
│ content.js       │ uci  │                       │
│  • đọc attribute │      │                       │
│  • show overlay  │      └───────────────────────┘
│  • bắt phím tắt  │
└──────────────────┘
```

- FEN đọc từ API của chính chess.com (`wc-chess-board.game.getFEN()`), lấy qua **content script chạy trong MAIN world** (`fen-bridge.js`) vì `game` không truy cập được từ isolated world. Bridge ghi FEN vào attribute `data-cc-hint-fen` trên board element — content script đọc attribute này. Luôn đúng bên đi, kể cả khi cầm quân đen ở ván mới bắt đầu hoặc tải lại trang giữa ván (move list còn trống).
- Nếu bridge chưa kịp ghi FEN (page vừa load), fallback về đọc DOM: class `square-11..88` (không còn `style.transform`).
- Engine được load bằng **blob URL** (fetch extension asset, tạo Blob, `new Worker(blobUrl)`) vì content script không tạo Worker từ `chrome-extension://` trực tiếp được.
- Cache theo FEN — khi thế cờ đổi (đối thủ đi), engine tự tính lại qua MutationObserver.

## Cấu trúc thư mục

```
chess-move-hint/
├── manifest.json          Manifest V3
├── content.js             Đọc DOM + điều phối engine + overlay
├── fen-bridge.js          Content script MAIN world: đọc game.getFEN() → attribute
├── styles.css             Style overlay (góc phải, dark)
├── options.html           Popup cài phím tắt
├── options.js             Logic options
├── lib/chess.min.js       chess.js 1.4.0 (convert UCI ↔ SAN)
├── engine/stockfish.js    Stockfish 10.0.2 (asm.js, 957KB)
└── icons/                 PNG 16/32/48/128
```

## Test

Thư mục `tests/` có script Playwright kiểm thử extension thực sự trên chess.com/analysis.

```powershell
cd tests
npm install playwright
npx playwright install chromium
node test.mjs
```

(Không chạy được với Google Chrome chính thức — phải dùng Chromium build của Playwright vì Chrome bỏ qua `--load-extension`.)

## Giấy phép & nguồn engine

- Stockfish: GPL-3.0, https://stockfishchess.org
- chess.js: BSD-3-Clause, https://github.com/jhlywa/chess.js
- Code extension: MIT.