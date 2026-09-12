# Kiểm chứng bản alpha

## Bổ sung v0.2 — PET

Đã kiểm tra PET tự xuất hiện khi vào fixture Shopee, không bấm nút bật; hover nút mua chỉ nhắc; guard vẫn giữ ba xác nhận; SPA đổi sản phẩm cập nhật PET và hủy guard cũ; không tạo PET trùng. Màn mô phỏng PET đã kiểm tra tự mount, hover, hủy hội thoại, viewport 390px và pageerror. Chạy `node tests/pet-preview.mjs` để kiểm lại preview. Giới hạn kiểm chứng Shopee thật vẫn giữ nguyên.

Môi trường: Windows, Node.js 24.14.0, Microsoft Edge qua Playwright có sẵn trên máy.

- 11 kiểm thử tự động cho logic/ngăn hồi quy: ngân sách, giá thiếu, overlap danh mục, xác nhận đủ ba lần, hủy, câu rỗng, nhập sai, hạn mở khóa, sản phẩm liên quan, chuyển tháng và dữ liệu nhiều tab.
- UI: nạp mẫu, đi hết câu hỏi và kiểm tra chưa có quyền sau hai xác nhận đầu, có quyền sau xác nhận ba, lưu hồ sơ qua reload, không tràn ngang 390px, không có pageerror.
- Extension MV3 thực sự được nạp vào Edge test profile; chặn click trên HTML fixture tại URL Shopee đã được test runner giả lập; không gửi giao dịch đến Shopee.
- Extension E2E: ba xác nhận không tự click; lần bấm tiếp theo đi qua đúng một lần; lần sau bị chặn lại; lưu hồ sơ ở dashboard cũ không xóa sự kiện từ tab sản phẩm.
- Đã xem ảnh desktop và hộp xác nhận; ảnh được lưu trong docs.

Chưa kiểm chứng: phiên Shopee thật đăng nhập, layout thực tế theo tài khoản, danh mục/khuyến mãi từ Shopee, giỏ nhiều món, biến thể đổi giá trong DOM, cuộc gọi AI có khóa thật, nhiều người dùng backend và hiệu năng tải lớn. Không xem những phần này là đã hoàn thành.

Chạy lại: `node --test tests/*.test.mjs`, `node tests/ui.mjs` (cần server đang chạy), `node tests/extension.mjs`. Hai script browser đang dùng đường dẫn Playwright của máy này; chuyển máy cần cập nhật import package.
