# Shopping Guardian — bản alpha chạy thử

## Mới trong v0.2: PET tự xuất hiện

Sau khi extension được cài và bật, mỗi lần truy cập `https://shopee.vn/`, PET tự khởi động ở góc phải. **Không cần mở dashboard, bấm biểu tượng extension hay chạy máy chủ localhost để PET hoạt động.** Dashboard chỉ là nơi tùy chọn sửa hồ sơ.

- Vào trang: PET xuất hiện và đọc thông tin sản phẩm nếu có.
- Rê chuột/focus nút mua hoặc thêm giỏ: nhắc nhẹ sau 650 ms, không tự bật hộp hỏi.
- Thêm giỏ: nhắc có thể để dành, không chặn thao tác thêm giỏ.
- Bấm mua/checkout: tự mở luồng cân nhắc hiện có.
- Chuyển sản phẩm trong cùng tab: cập nhật PET, bỏ quyền mở khóa và đóng hội thoại của món cũ.

Xem hình dáng PET tại http://127.0.0.1:4173/pet-preview.html khi server đang chạy. Đây là trang mô phỏng, không phải kết nối Shopee thật. PET nhận biết hành vi cụ thể, không đọc được ý nghĩ.

Nếu đã cài bản v0.1 từ thư mục `extension`, vào trang quản lý extension bấm **Tải lại** một lần rồi tải lại Shopee. Nếu chưa cài, làm bước cài lần đầu bên dưới. Trình duyệt không cho một trang web tự cài extension vào hồ sơ duyệt web của bạn; bản mã được tạo chưa đồng nghĩa đã cài vào browser cá nhân.

Một khoảng dừng trước khi mua. Giao diện tiếng Việt, extension Chrome/Edge và bản demo cục bộ dùng chung bộ quy tắc.

## Mở ngay

Trong thư mục dự án, chạy `node server.mjs` rồi mở http://127.0.0.1:4173. Hoặc bấm đúp `Start-Guardian.cmd`, giữ cửa sổ đó mở rồi truy cập địa chỉ. Cần Node.js 22 trở lên; máy hiện tại đã có Node 24. Không cần cài dependency để chạy app.

1. Chọn **Nạp dữ liệu mẫu**.
2. Vào **Thử trợ lý**, đặt giá 5.000.000 ₫ để chắc chắn vượt ngân sách mẫu.
3. Trả lời ba câu hỏi → Tôi vẫn muốn mua → xác nhận ba lần.
4. Thử “Để dành”, xem danh sách chờ, thay đổi ngân sách và phản hồi lịch sử.
5. Muốn câu chốt “tao / mày”, chọn giọng Bạn thân trong Hồ sơ.

## Cài extension

Mở `chrome://extensions` hoặc `edge://extensions`, bật Developer mode, chọn Load unpacked và chọn thư mục `extension`. Bấm biểu tượng Guardian để mở dashboard. Tải lại trang Shopee sau khi cài. Dữ liệu dashboard localhost và extension lưu riêng, không tự đồng bộ.

Extension can thiệp các nút có nhãn Mua ngay / Mua hàng / Đặt hàng / Thanh toán và nhãn tiếng Anh tương ứng. Sau xác nhận, người dùng phải tự bấm lại; quyền mở khóa chỉ 1 lần trong 60 giây, khớp URL + tên + giá đã đọc. Đây là trợ lý tự nguyện, không phải cơ chế cấm không thể vượt qua.

## Đã có và chưa có

| Đã triển khai | Giới hạn hiện tại |
|---|---|
| Hồ sơ, ngân sách theo tháng, dữ liệu mẫu chủ động | Chưa đồng bộ nhiều thiết bị |
| Nhập JSON đơn đã mua; phản hồi hữu ích/hối tiếc | Chưa tự lấy lịch sử tài khoản Shopee |
| Điểm quy tắc giải thích được, câu hỏi và 3 xác nhận | Chưa đánh giá ý nghĩa câu trả lời bằng LLM trong luồng chặn |
| Để dành với mốc 24 giờ; xuất/xóa dữ liệu | Mốc nghỉ là gợi ý, không ép khóa 24 giờ |
| Đọc JSON-LD và semantic metadata, can thiệp click | Chưa chứng nhận trên Shopee đăng nhập, mọi biến thể/giỏ hàng/checkout |
| Endpoint lời khuyên AI tùy chọn | Chưa chạy API thật vì chưa cấu hình khóa/model |

Không gọi số lần dừng là “tiền tiết kiệm”: chưa thể chứng minh người dùng không mua món đó ở nơi khác. Không coi “mở khóa” là “đã mua”. Điểm số chỉ là heuristic; không phải xác suất hối tiếc hay kết luận tính cách.

## AI tùy chọn

Trên máy chủ đặt biến môi trường `OPENAI_API_KEY` và `OPENAI_MODEL` thành khóa/model có quyền truy cập, sau đó khởi động lại `node server.mjs`. Trong bản localhost, bấm **Xin góc nhìn AI**. Khóa không gửi về trình duyệt, không lưu vào tệp nguồn. Endpoint gửi sản phẩm đang nhập, ngân sách còn lại và đánh giá quy tắc; không gửi toàn bộ lịch sử. Timeout 12 giây, lỗi AI không làm hỏng luồng cục bộ. Không có LLM nào được tự mở khóa.

Hiện lời khuyên dùng Responses API theo [tài liệu tạo văn bản OpenAI](https://developers.openai.com/api/docs/guides/text). Chưa cấu hình một model cố định vì quyền truy cập và chi phí phụ thuộc tài khoản. Để dùng lời khuyên trong extension cần bổ sung kết nối backend có xác thực và đồng ý chia sẻ dữ liệu, thay vì nhúng khóa API.

## Định dạng nhập

Nhập **thay thế** lịch sử hiện có. Tối đa 2 MB, 2.000 đơn. Xuất dữ liệu trước khi thay thế nếu cần giữ bản cũ.

```json
[{"name":"Bình nước","price":189000,"date":"2026-09-11","category":"home","feedback":"useful"}]
```

Nhóm gợi ý: gadgets, electronics, home, other. Feedback: useful, regret hoặc bỏ trống. File xuất toàn bộ là bản sao lưu để lưu giữ, không phải định dạng nhập đơn; lấy trường `orders` nếu muốn nhập lại lịch sử.

## Kiểm thử và mã nguồn

`node --test tests/*.test.mjs` chạy kiểm thử logic. `tests/ui.mjs` kiểm tra với Playwright/Edge; script hiện tham chiếu runtime Playwright có sẵn trên máy tạo, cần sửa đường dẫn require khi chuyển máy.

- `extension/engine.js`: đánh giá và trạng thái xác nhận.
- `extension/extractor.js`, `content.js`: dữ liệu trang và capture click.
- `extension/guard.js`: hộp thoại Shadow DOM, focus và bàn phím.
- `extension/store.js`, `background.js`: lưu cục bộ, tuần tự hóa ghi từ các tab extension.
- `extension/app.js`: dashboard; `server.mjs`: phục vụ demo và API tùy chọn.
- `docs/ROADMAP.md`: stack mục tiêu, nghiên cứu, milestones và tiêu chí nghiệm thu.

Extension dùng content script trong isolated world theo [tài liệu Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts). Việc đọc trang không bảo đảm mọi đường mua bị chặn; cần kiểm thử theo phiên bản trang và không dùng bản alpha như cơ chế kiểm soát chi tiêu bắt buộc.
