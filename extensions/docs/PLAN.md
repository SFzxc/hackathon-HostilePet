# Shopping Guardian — thiết kế và kế hoạch

Ứng dụng mới, kiến trúc local-first. Người dùng đã yêu cầu tự quyết và làm xuyên suốt. Chọn extension MV3 với dashboard có thể mở riêng để demo, cùng một decision engine. Không tự thanh toán. Không suy diễn tính cách thành sự thật. Dữ liệu mẫu phải được gắn nhãn.

1. Viết kiểm thử engine: ngân sách, thiếu giá, trùng danh mục, câu trả lời, ba xác nhận và hạn mở khóa. Chạy đỏ rồi triển khai.
2. Dashboard: hồ sơ, lịch sử JSON có kiểm tra, phản hồi sử dụng/hối tiếc, danh sách chờ, đánh giá sản phẩm và hội thoại. Lưu cục bộ, xuất và xóa dữ liệu.
3. Extension: JSON-LD/semantic extraction, capture buy intent, Shadow DOM dialog, mở khóa một lần theo URL + tên + giá, tuyệt đối không tự click mua. Chưa coi click là đơn thành công.
4. Backend cục bộ: phục vụ bản demo, endpoint cố vấn tùy chọn; khóa chỉ từ biến môi trường, giới hạn body/timeout, dữ liệu trang chỉ là dữ liệu.
5. Kiểm thử engine và UI; đóng gói extension; ghi hướng dẫn cài và roadmap nghiên cứu.

Tiêu chí: demo hoạt động không cần API; người dùng có đường hủy và override; thiếu dữ liệu được nói rõ; bản extension thử nghiệm không tuyên bố chặn mọi đường checkout Shopee.

## Thay đổi v0.2 — PET chủ động

Phạm vi đã được người dùng yêu cầu trực tiếp: thay trải nghiệm phải vào dashboard bằng PET tự khởi động trên Shopee. PET SVG/CSS-native (thực tế CSS trong Shadow DOM), không cần ảnh AI, không thu thập thêm dữ liệu. Hover/focus nhắc nhẹ; mua mở guard; thêm giỏ không chặn. Khởi động không lấy focus. Theo dõi DOM có debounce và kiểm tra URL định kỳ khi trang hiển thị. Generation token hủy review đang đợi khi đổi sản phẩm.

- [x] Kiểm thử tự xuất hiện thất bại trước khi thêm PET.
- [x] PET + capture ý định + cập nhật context SPA.
- [x] Màn mô phỏng tự hiển thị, không ghi vào hồ sơ.
- [x] Kiểm tra Edge MV3, giữ một PET, hover, chặn mua và chuyển sản phẩm.
- [x] Rà soát độc lập, sửa race khi đợi storage.
