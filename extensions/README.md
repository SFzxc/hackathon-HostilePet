# Guardian Behavior Recorder 1.0

Bản mới chuyển Shopping Guardian sang ghi nhận hành vi. Không chặn click mua, không hiện câu hỏi cân nhắc mua. Chạy được một mình, không cần server.

## Cài và chạy

1. Giải nén `Guardian-Recorder-1.0.zip` vào một thư mục cố định, hoặc dùng thư mục `extension` của dự án.
2. Mở `chrome://extensions` hoặc `edge://extensions`, bật **Developer mode / Chế độ nhà phát triển**.
3. Nếu đã cài bản cũ từ thư mục này: bấm **Reload**. Nếu chưa: chọn **Load unpacked / Tải tiện ích đã giải nén**, chọn thư mục chứa `manifest.json`.
4. Tải lại các tab Shopee, Facebook, X/Twitter đang mở. Góc dưới trái có nút **Recorder · Đang ghi**.
5. Mở **F12 → Console**, lọc `schemaVersion`, bật **Preserve log**. Mỗi dòng log là một JSON hoàn chỉnh.
6. Bấm biểu tượng extension hoặc nút Recorder để tạm dừng, đọc lịch sử và xuất JSON/Markdown.

Extension tự chạy trên mọi trang HTTP/HTTPS khi trình duyệt mở. Nó không chạy khi trình duyệt đóng; sau khởi động trình duyệt sẽ tiếp tục. Chế độ ẩn danh mặc định không được bật. Không có gì rời khỏi máy này. Khi app HostilePet đang chạy ở chế độ dev, extension gửi thêm một tín hiệu tối thiểu tới `ws://127.0.0.1:54321` — xem mục **Nối tới app desktop** ở cuối.

## Những gì được ghi

| Nhóm | Sự kiện |
|---|---|
| Trang, tab và chú ý | `page_view`, `page_session_ended`, `page_focus_changed`, `tab_focus_changed`, `attention_snapshot`, `visibility_changed`, `scroll_depth` |
| Sản phẩm | `product_view`, `product_impression`, `product_hover`, `product_dwell` |
| Tìm kiếm và tương tác | `search_submitted`, `search_query_observed`, `click`, `selection_changed` |
| Tín hiệu mua | `cart_click`, `buy_click`, `checkout_click` |
| Feed | `content_impression` |
| Video / live | `media_play`, `media_pause`, `media_ended`, `media_volumechange`, `media_seeked`, `livestream_context`, `livestream_dwell` |
| Lịch sử và tổng hợp | `purchase_history_snapshot`, `purchase_habits_updated`, `history_sync_started`, `history_sync_finished` |

JSON có phiên bản schema, ID sự kiện, thời gian, phiên trang, hostname thực tế, URL đã lọc query, `page.siteType` và dữ liệu quan sát. `siteType` là heuristic local: `shopping`, `entertainment`, `work`, `social`, `news`, `finance` hoặc `other`. Dữ liệu do tác vụ tự động thu thập có `source: automatic_collection`; tổng hợp lịch sử có `source: automatic_analysis`. `sessionId` là phiên content script trong một tài liệu, không phải danh tính người dùng xuyên thiết bị.

`tab_focus_changed` cho biết tab hỗ trợ nào vừa được kích hoạt hoặc rời foreground, với URL/title đã lọc. `page_focus_changed` ghi thay đổi focus của document. `attention_snapshot` được ghi khi đổi trạng thái và tối đa mỗi giây, gồm `pageLifetimeMs`, `totalFocusedMs`, `totalActiveMs`, `continuousFocusMs`, `continuousActiveMs`, trạng thái `active`/`idle`/`background`, cùng số lần pointer move, click, scroll và keydown đã cộng dồn. Background cũng thêm `tabLifetimeMs`, `tabTotalFocusedMs` và `tabTotalActiveMs` theo tab kể từ khi extension quan sát tab đó.

Suy luận theo quy tắc: tìm kiếm → researching; xem sản phẩm → exploring; xem lâu → considering; thêm giỏ → planning_purchase; bấm mua/thanh toán → purchase_imminent. Có bằng chứng và confidence, nhưng confidence chưa được hiệu chuẩn thống kê. Không suy diễn một click thành giao dịch thành công.

## Đọc lịch sử Shopee

Khi bật tự động: mở tab nền lần đầu bạn vào Shopee và tối đa mỗi 24 giờ; lịch chạy tiếp tục khi trình duyệt mở. Có thể bấm **Đọc lịch sử Shopee ngay** bất kỳ lúc nào.

Trang dùng: https://shopee.vn/user/purchase/?type=3. Dùng phiên đăng nhập có sẵn. Quét DOM và cuộn 8 lần trong khoảng 15 giây; sau đó đóng tab do extension mở nếu tab vẫn ở trang lịch sử. Có timeout khoảng một phút (trình duyệt có thể trì hoãn alarm). Nếu bạn chuyển tab đó sang trang khác, recorder không đóng trang mới. Không tự đăng nhập hoặc vượt CAPTCHA.

Đây là **lịch sử từng phần**, không phải cam kết tải hết đơn. Chỉ lấy tối đa 300 dòng mỗi snapshot và giữ tối đa 1.000 dòng. Chỉ tổng hợp đơn hoàn thành có ID đơn và sản phẩm xác định; các dòng thiếu ID vẫn xuất để review nhưng không được đếm thành mua lặp lại. Số lượng không đọc được giữ `null`. Ngày/giá chưa xác minh giữ `null`, không tính chi tiêu hay tần suất mua. Giao diện Shopee thay đổi có thể khiến dữ liệu thành `unknown` hoặc không đọc được.

Tác vụ lỗi/đòi đăng nhập hiển thị trạng thái trong bảng điều khiển. Đăng nhập Shopee ở tab thường rồi bấm đọc lại. Không coi “không đọc được dòng nào” là “người dùng chưa mua hàng”.

## Phạm vi và giới hạn

- Hỗ trợ mọi trang HTTP/HTTPS. Trang nội bộ trình duyệt như `chrome://`/`edge://` không cho extension chạy theo cơ chế của trình duyệt.
- Thu thập semantic DOM. Không phân tích video/âm thanh/OCR; không nhìn xuyên iframe, canvas hoặc nội dung chưa tải. Livestream hiện ghi tiêu đề, sản phẩm liên kết và thời gian chú ý ước lượng.
- `product_dwell` là thời gian tab có focus, hiện và có tương tác trong 60 giây gần nhất; không phải eye tracking. `attention_snapshot` ghi mỗi giây và khi focus đổi. Hover là tối thiểu một giây. Scroll ghi các mốc 25%.
- Chỉ đọc giá trị ô tìm kiếm khi Enter/submit hoặc từ URL; không ghi toàn bộ phím gõ. Bỏ qua trang tin nhắn, đăng nhập và các vùng dialog/chat/contenteditable nhận diện được. Lựa chọn form ghi loại tương tác, không lấy nội dung trường. Cách lọc này cũng bỏ qua một số tương tác hợp lệ trong dialog.
- Nội dung bài viết/nhãn công khai và tìm kiếm có thể chứa thông tin cá nhân: dữ liệu xuất vẫn là dữ liệu duyệt web của bạn. Có nút tạm dừng và xóa; bản ghi console cũ không bị xóa khi xóa kho lưu trữ extension.
- Lưu vòng tối đa 2.000 sự kiện, đồng thời giới hạn khoảng 6 MB cho buffer sự kiện. `droppedEvents` cho biết số sự kiện đã bị loại; xuất định kỳ nếu cần lưu dài hạn.
- Đóng tab đột ngột/thoát trình duyệt có thể mất sự kiện cuối. Tín hiệu gửi tới app là best-effort: gửi lúc app không chạy thì bị bỏ, không xếp hàng và không gửi lại. Kho event cục bộ mới là bản ghi đầy đủ.

## Dữ liệu mẫu và kiểm thử

- `docs/recorder-sample.json`: log thực tế từ extension chạy trên fixture Shopee mô phỏng.
- `docs/recorder-social-sample.json`: export qua giao diện từ fixture Facebook/X/live và tác vụ lịch sử nền.
- `docs/recorder-review.md`: tổng hợp dễ đọc và phạm vi xác minh.
- `docs/recorder-panel.png`: ảnh giao diện chạy thử.

Các file mẫu **không phải dữ liệu tài khoản thật**. Kiểm thử dùng Edge thật ở chế độ headless và thay nội dung mạng bằng fixture. Chưa xác minh độ phủ trên DOM tài khoản Shopee/Facebook/X đã đăng nhập của bạn.

Chạy unit tests: `npm test`. Chạy tích hợp: `npm run test:recorder` (cần Edge và Playwright; các test đang sử dụng runtime có sẵn trên máy này).

## Nối tới app desktop

Điểm vào tập trung: `extension/recorder-background.js`, hàm `save`. Giữ `id` làm khóa chống trùng và giữ riêng dữ liệu quan sát với `inference`. Sink cục bộ vẫn là console + storage; thêm vào đó, sau khi event đã nằm trong storage, `save` chuyển tiếp nó qua `extension/desktop-bridge.js` tới app HostilePet trên `ws://127.0.0.1:54321`. Vì gửi diễn ra *sau* khi lưu và kết quả bị bỏ qua, app không chạy cũng không làm mất event nào.

Chỉ bốn loại sự kiện trở thành tín hiệu: `attention_snapshot`, `visibility_changed`, `tab_focus_changed`, `page_session_ended` — đó là những loại mang thay đổi về thời gian quan sát hoặc focus. Các loại khác bị bỏ qua có chủ đích: `content_impression` bắn một lần cho mỗi bài viết hiển thị, nên chuyển tiếp tất cả sẽ tiêu hết hạn mức của cầu nối vào những tín hiệu 0 mili-giây.

Tín hiệu chỉ chứa host, loại trang (`social`, `shopping`, …) và số mili-giây đủ điều kiện. Không có URL, tiêu đề hay nội dung trang trong đó. App chỉ tính thời gian khi tab đang hoạt động, cửa sổ đang focus, tài liệu hiển thị và người dùng không idle — extension gửi đúng bốn cờ đó, và không bao giờ suy đoán thay. App cũng dùng cờ hiển thị/focus để biết host nào đang thực sự ở trước mặt bạn: rời tab thì `visibility_changed` báo `visible: false`, host đó rời khỏi tập đang-xem, và pet thôi giữ biểu cảm gắn với host đó.

Đóng tab là đường thứ hai, và nó không đi qua `visibility_changed`: `page_session_ended` bắn từ `pagehide`, lúc tài liệu vẫn còn đo được trong chốc lát. Tín hiệu đó vì thế phải được dịch thành `visible: false` **trước** khi xét tới phần thời gian nó mang theo (`desktop-bridge.js`, hàm `qualification`) — nếu không nó tự nhận là đang hiển thị và đang được focus, và đóng tab lại hoá thành khẳng định "tôi vẫn ở đây". App không phụ thuộc riêng vào lời tạm biệt đó: một page im lặng 15 giây thì mất tư cách đang-được-xem, và im lặng 90 giây thì bị quên hẳn cùng thời gian đã tích, nên tab bị đóng, bị crash hay bị Chrome thu hồi đều được dọn như nhau (`site-tracker.ts`, `PRESENCE_STALE_MS` và `PAGE_STALE_MS`).

App có thể trả ngược lại một `intervention.request`; `recorder-background.js` chuyển nó tới đúng tab qua `desktop-intervention`, và `recorder.js` ghi nhận vào console. Giao thức đầy đủ: `apps/desktop/docs/protocol.md`.

Thiết kế dựa trên content script cô lập theo [Chrome Extensions documentation](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts). Mã cân nhắc mua cũ vẫn nằm trong source để tham khảo, nhưng không được manifest hiện tại nạp và không nằm trong ZIP recorder.

## Thiết lập môi trường kiểm thử trên máy khác

Cài Node.js và Microsoft Edge, sau đó cài Playwright bằng `npm install --no-save playwright`. Các test tự tìm package trong dự án; nếu dùng runtime ngoài dự án, đặt `PLAYWRIGHT_PACKAGE_JSON` tới file package.json của runtime đó. Không commit giá trị biến môi trường hoặc đường dẫn máy cá nhân.

Browser profiles, ảnh chụp, ZIP và file dữ liệu review/export được giữ cục bộ, không đưa lên Git. Chạy test recorder để tạo lại dữ liệu fixture mẫu.
