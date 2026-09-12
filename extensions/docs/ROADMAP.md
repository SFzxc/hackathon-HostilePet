# Từ bản thử đến cố vấn mua sắm cá nhân

## 1. Định nghĩa sản phẩm

Guardian giúp người dùng ra quyết định theo nhu cầu tự khai báo, ngân sách và trải nghiệm. Không có dữ liệu nào cho phép đánh giá một con người “phổ quát chính xác”. Mục tiêu kỹ thuật thực tế là đưa ra nhận định có bằng chứng, mức chắc chắn và khả năng sửa. Một món giải trí cũng có thể đáng mua khi người dùng chủ động dành ngân sách cho nó.

Ba hướng: chỉ chatbot dễ dựng nhưng không can thiệp hành động; extension + local engine kiểm soát được thời điểm và phản hồi nhanh; agent tự điều khiển toàn bộ browser phức tạp và nhiều quyền quá mức. Chọn hướng thứ hai.

## 2. Stack: bản hiện tại và bản phát triển tiếp

| Lớp | Bản đã làm | Khi phát triển beta |
|---|---|---|
| Extension | JavaScript ES modules, Manifest V3 | TypeScript + WXT để đóng gói và kiểm tra kiểu |
| Dashboard | HTML/CSS/JS không dependency | React nếu số màn hình/state tăng; giữ engine độc lập |
| Trạng thái mua | Hàm chuyển trạng thái deterministic | XState nếu cần khôi phục nhiều phiên và checkout nhiều bước |
| Storage | chrome.storage.local / localStorage demo | IndexedDB cho nhiều sự kiện; server PostgreSQL khi có sync |
| Backend | Node HTTP cục bộ | Fastify hoặc NestJS + schema validation + auth |
| Memory | Hồ sơ, lịch sử, phản hồi | PostgreSQL facts có nguồn; pgvector khi truy hồi ngữ nghĩa đã chứng minh cần |
| AI | Lời khuyên qua Responses API tùy chọn | Schema output + context builder + eval + model routing |
| Jobs/cache | Chưa cần | Redis/BullMQ khi thực sự có queue, nhiều worker hoặc nhắc sau mua |

Đây là đề xuất thiết kế; không cần triển khai PostgreSQL, Redis, vector DB và agent framework cùng lúc để có MVP tốt.

## 3. Luồng quyết định mục tiêu

```text
HTML hiển thị → extractor + confidence → ProductSnapshot
                  ↓
       local rules + ngân sách hiện tại
          ↓                     ↓
       ít rủi ro              thiếu dữ kiện / cần cân nhắc
          ↓                     ↓
     nhắc kiểm tra          context builder → LLM câu hỏi
                                ↓
                       câu trả lời → structured evaluation
                                ↓
                       gợi ý mua / trì hoãn / hỏi thêm
                                ↓
              người dùng muốn vượt → 3 xác nhận → quyền 1 lần
```

Luồng alpha đã thực hiện câu hỏi cố định và review câu trả lời. Beta mới dùng AI để chọn câu tiếp theo dựa trên thông tin còn thiếu, tối đa 3–5 lượt, không vòng lặp tra hỏi vô hạn. Quyền override luôn tồn tại. LLM chỉ đề xuất; state machine kiểm tra transition.

## 4. Đọc Shopee đáng tin cậy

Nghiên cứu MV3, run_at document_start, event capture, SPA navigation, DOM observer, JSON-LD, selected variants, tiền tệ, giỏ nhiều dòng và accessible names. Không đọc toàn trang gửi LLM. Không dùng API nội bộ không tài liệu làm phụ thuộc duy nhất; không lấy cookie/token tài khoản.

ProductSnapshot beta: productId/shopId nếu hiển thị, URL chuẩn, title, selectedVariant, quantity, unitPrice, shipping, total, currency, source, capturedAt, extractionVersion, confidence. Giá chưa rõ/range không được mặc định bằng 0. Không chọn ngẫu nhiên sản phẩm liên quan.

Tạo corpus HTML đã loại dữ liệu riêng tư: sản phẩm thường, hết hàng, biến thể đổi giá, voucher, SPA chuyển sản phẩm, ngôn ngữ khác, giỏ nhiều món, thanh toán. Viết DOM fixture test và thử trực tiếp phiên đăng nhập bằng hành động không đặt đơn. Mỗi selector có nguồn và fallback, observer chỉ theo dõi vùng liên quan và debounce.

Lịch sử: alpha nhập JSON. Beta thêm “Nhập từ trang đơn hàng đang mở” theo thao tác chủ động, xem trước kết quả, deduplicate theo orderId/itemId, chỉ tính trạng thái đã nhận hoặc trạng thái người dùng chọn. Hoàn tiền/hủy phải được điều chỉnh riêng. Không tuyên bố có đơn thành công từ click.

## 5. Hiểu context và memory

- Hồ sơ có cấu trúc: ngân sách discretionary, mục tiêu, món sở hữu, sở thích người dùng xác nhận, chế độ giao tiếp.
- Episodic: xem/cân nhắc/để dành/override/mua xác nhận/hoàn tiền, kèm thời điểm và nguồn.
- Facts: statement, sourceEventIds, confidence, confirmedByUser, validFrom, expiresAt. Suy luận mới phải ghi “có thể”, có nút sửa/xóa.
- Working context: sản phẩm, câu trả lời hiện tại, ngân sách, 5–10 dữ kiện liên quan. Không gửi toàn bộ history.
- Truy hồi ban đầu bằng category/product type + thời gian; embeddings chỉ dùng khi keyword thiếu recall. Cùng category không chứng minh duplication.

Schema server đề xuất: users, profiles, product_snapshots, order_items, decision_events, facts, feedback. Mọi bảng thuộc user_id, phân quyền server, unique event_id cho idempotency, xóa theo người dùng. Không lưu raw HTML mặc định.

## 6. AI thông minh, nhanh và ngắn

Local rule chặn ngay đồng bộ trước khi đợi AI. Mục tiêu đo lường (chưa phải benchmark đạt): rule P95 < 50 ms; modal < 150 ms; câu đầu AI < 2 s; toàn câu trả lời < 5 s; timeout 8–12 s có fallback. Dùng performance marks trên máy phổ thông và sản phẩm dài, đo cả cold start.

Model router: ca đơn giản dùng quy tắc; ca cần viết lại câu hỏi dùng model nhanh; ca xung đột nhiều dữ kiện mới dùng model mạnh. Chọn model bằng bộ eval tiếng Việt và ngân sách thực tế, không chọn chỉ vì tên hay kích thước. Cache theo product/variant/price + profileVersion + historyVersion, TTL ngắn, đổi ngân sách phải vô hiệu cache.

Output beta:
```json
{"recommendation":"WAIT","reasonCodes":["BUDGET_PRESSURE"],"evidenceIds":["budget-2026-09"],"uncertainties":["usage_frequency"],"nextQuestion":{"strategy":"FREQUENCY","text":"Bạn dự kiến dùng mấy lần một tuần?"},"summary":"Món này vượt phần ngân sách còn lại."}
```

Validate enums, lengths, referenced evidence IDs và số câu hỏi. Prompt giới hạn một câu hỏi/lượt và 60–100 từ. Nội dung sản phẩm/câu trả lời là dữ liệu không tin cậy, không được điều khiển system instructions. Output được render dạng text; không cho LLM gọi checkout. Structured Outputs giảm lỗi cấu trúc, không chứng minh tính đúng của phán đoán. Tham khảo [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) và [tạo văn bản](https://developers.openai.com/api/docs/guides/text).

## 7. Nghiên cứu theo thứ tự và tiêu chí nghiệm thu

| Giai đoạn | Nội dung học/làm | Sản phẩm đầu ra và gate |
|---|---|---|
| 1 · 1–2 tuần | DOM, MV3, event propagation, SPA, price parsing | Bộ fixtures ít nhất 30 trạng thái; không đọc sai giá thành confident; thử can thiệp mouse/keyboard |
| 2 · 1 tuần | Data contracts, lịch sử, budgets, idempotency | Import preview, chống trùng, xử lý đơn hủy/hoàn; không mất dữ liệu khi mở nhiều tab |
| 3 · 1–2 tuần | Decision theory, câu hỏi nhu cầu, state machines | Các đường mua/hủy/chờ/override được E2E; không unlock thiếu xác nhận |
| 4 · 1–2 tuần | Prompt, structured output, context retrieval | 100–200 ca tiếng Việt có nhãn; câu hỏi liên quan, không bịa bằng chứng; timeout an toàn |
| 5 · 2 tuần | Personalization, feedback bias, privacy | Người dùng sửa/xóa memory; khảo sát sử dụng/hối tiếc sau 7/30 ngày; opt-in |
| 6 · 1–2 tuần | Observability, extension release, beta | 10–20 người thử tự nguyện; đo false intervention, latency, override, usefulness |

Ước lượng cho một người có kinh nghiệm, không là cam kết thời gian. Bản alpha hiện tại là cơ sở kiểm tra ý tưởng trước các gate beta.

## 8. Đánh giá chất lượng

Tạo bộ tình huống: đồ thiết yếu nhưng vượt budget, quà tặng, mua thay đồ hỏng, hobby có ngân sách riêng, mặt hàng tương tự nhưng khác công dụng, giảm giá đã nghiên cứu lâu, lịch sử thiếu, người dùng khó chịu, prompt injection trong tên hàng.

Metrics: tỷ lệ trích xuất đúng giá/variant; tỷ lệ cảnh báo không đáng; tỷ lệ câu hỏi bổ sung được thông tin; usefulness tự đánh giá; mức hối tiếc sau mua; tỷ lệ override; thời gian phản hồi và chi phí mỗi quyết định. Không tối ưu giảm số đơn bằng mọi giá. Không dùng “không mua” như nhãn thắng tuyệt đối.

Chỉ fine-tune khi có dữ liệu gán nhãn đồng ý sử dụng, tập kiểm tra độc lập theo thời gian/người dùng và baseline retrieval tốt. Contextual bandit là nghiên cứu muộn: can thiệp hành vi cần giới hạn rõ, không âm thầm thử mức gây áp lực.

## 9. Vận hành và ranh giới

Khoá API ở server, xác thực extension trước khi bật backend remote, rate-limit theo người dùng, quota chi phí, log không chứa prompt/raw history mặc định. Đồng bộ cần backup, retention, export/delete, TLS và user isolation. Đọc lại chính sách nền tảng trước khi phân phối rộng. Các yêu cầu pháp lý phụ thuộc thị trường, cần đánh giá riêng khi thương mại hóa.

Tài liệu nền tảng: [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [storage](https://developer.chrome.com/docs/extensions/reference/api/storage), [permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions). Mã alpha hiện chỉ xin storage và content script cho shopee.vn.
