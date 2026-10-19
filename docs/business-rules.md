# Quy tắc nghiệp vụ

Các công thức nằm trong `apps/api/src/domain` (có unit test). Tài liệu này giải thích _vì sao_ và _khi nào_.

## Tiền, ngày

- Tiền là **số nguyên đồng**; mỗi bước tính đều làm tròn về đồng. Khi chia một khoản cho nhiều dòng (giảm giá đơn, hao hụt), phần dư dồn cho các dòng có phần lẻ lớn nhất → tổng luôn khớp tuyệt đối.
- **Ngày kinh doanh** theo `business_day_start` (mặc định 04:00): đơn lúc 01:30 sáng ngày 12 thuộc ngày 11.

## Đơn hàng

| Bước             | Quy tắc                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Giá              | Theo kênh và ngày kinh doanh của đơn: tại quán / mang về dùng giá `STORE`; đơn app dùng giá riêng của app đó → giá app chung → giá tại quán. Nhân viên không sửa giá, chỉ giảm giá    |
| Tổng tiền        | tạm tính − giảm giá món − giảm giá đơn = doanh số → + phụ thu (chỉ kênh được cài) → + VAT (`EXCLUSIVE`) hoặc tách VAT ra khỏi giá (`INCLUSIVE`)                                       |
| Doanh thu thuần  | doanh số + phụ thu, **không gồm VAT** (VAT là tiền thu hộ, báo riêng)                                                                                                                 |
| Giảm giá         | Bắt lý do. Vượt `max_discount_pct` cần ADMIN nhập PIN; lưu người duyệt                                                                                                                |
| Gửi bếp          | Món mới chia theo trạm của nhóm món (Bếp / Bar). Món đã gửi chỉ **huỷ** được (có lý do, hỏi đã chế biến chưa)                                                                         |
| Thanh toán       | Tổng các hình thức phải bằng số cần trả. Trừ kho FIFO theo định mức (bao bì chỉ khi mang về / app). Thiếu hàng vẫn bán → **nợ kho**                                                   |
| Bán dưới giá vốn | Doanh thu thuần < giá vốn → bắt lý do trước khi thanh toán                                                                                                                            |
| Huỷ đơn          | Không xoá: chuyển "Đã huỷ" + lý do. Đơn mở / đã trả trong ngày: nhân viên được huỷ. Ngày trước hoặc ngày đã chốt: cần ADMIN (PIN). Đã trả → hoàn lô; món đã chế biến → phiếu xuất huỷ |
| Đồng thời        | Mỗi lần sửa đơn gửi kèm `version`; máy khác đã sửa trước → 409, POS tải lại đơn                                                                                                       |

## Kho

- **FIFO theo lô**: mỗi dòng phiếu nhập là một lô với giá nhập riêng; xuất lấy lô cũ nhất trước. Lô bị khoá hàng (`SELECT … FOR UPDATE`) theo thứ tự để không trùng khi 2 máy thanh toán cùng lúc.
- **Nợ kho**: bán khi chưa nhập hàng → dòng xuất có `pending_qty`, tạm tính theo giá nhập gần nhất. Phiếu nhập sau đó **tất toán** nợ kho (cũ trước), giá vốn của đơn liên quan được tính lại.
- Phiếu nhập chỉ sửa / xoá được khi lô chưa bị dùng.

## Kiểm kê

- Tồn sổ sách tại ngày kiểm = Σ nhập (≤ ngày) − Σ xuất (≤ ngày, gồm nợ kho) − Σ thiếu của các lần kiểm trước.
- Chốt: **thiếu** → trừ lô FIFO; **thừa** → tạo lô mới giá nhập gần nhất (bù nợ kho trước).
- Giá trị thiếu / thừa **phân bổ vào món** theo lượng nguyên liệu mỗi món đã dùng từ lần kiểm kê trước (hoặc từ tồn đầu). Không món nào dùng → "hao hụt chung".

## Giá thành & giá bán

| Chỉ tiêu             | Công thức                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Giá vốn trực tiếp    | Σ định mức × giá nhập gần nhất (+ bao bì nếu mang về / app)                                                                           |
| Chi phí chung / phần | giá bán × tỷ lệ chi phí chung (xem dưới)                                                                                              |
| Giá gợi ý tại quán   | giá vốn ÷ % food cost mục tiêu, làm tròn lên                                                                                          |
| Giá gợi ý app        | **mỗi app một giá**: giữ nguyên lãi ròng / phần như tại quán sau chiết khấu của app đó                                                |
| Cảnh báo             | giá vốn + chiết khấu ≥ giá bán (tại quán hoặc **bất kỳ app nào**) → "Đang lỗ"; % nguyên liệu vượt mục tiêu + ngưỡng → "Vượt mục tiêu" |

**Giá bán theo app.** Món có giá tại quán, một **giá app chung** và có thể có **giá riêng cho từng app**
(Grab, Shopee…). Đơn app lấy giá riêng của app → nếu không có thì giá app chung → nếu không có thì giá tại quán.
Mỗi loại giá có lịch sử theo ngày áp dụng.

**Tỷ lệ chi phí chung.** _Tự tính_ = chi phí chung ÷ doanh thu thuần của các tháng **bán trọn vẹn** trong 3 tháng
trước (bỏ tháng mở quán dở dang và tháng không có doanh thu, vì tháng đó vẫn chịu đủ tiền mặt bằng, lương).
Không có tháng nào trọn vẹn, hoặc tỷ lệ ra **trên 100%** → dùng tỷ lệ nhập tay và ghi lý do ở Bảng tính giá / Cài đặt.

## Chặn thay đổi làm sai số liệu

| Thao tác                                         | Quy tắc                                                                                                    |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Đổi đơn vị kho / đơn vị định mức / hệ số quy đổi | Chặn khi nguyên liệu đã có tồn kho (lô) hoặc nằm trong định mức — số tồn và định mức đang theo đơn vị cũ   |
| Ẩn bàn                                           | Chặn khi bàn còn đơn chưa thanh toán                                                                       |
| Giá bán / định mức có ngày áp dụng trong quá khứ | Chặn nếu món đã có đơn bán từ ngày đó trở đi (đơn đã bán giữ giá / định mức cũ); món chưa bán thì cho phép |
| Đơn mở từ ngày kinh doanh trước                  | Ngày đó không chốt được; cảnh báo ở Tổng quan và thanh vàng trên sơ đồ bàn                                 |

## Lãi lỗ tháng

Tháng là đơn vị chốt; quý / năm luôn bằng tổng các tháng.

| #           | Dòng                                                                                |
| ----------- | ----------------------------------------------------------------------------------- |
| 1           | Doanh thu bán hàng (trước giảm giá)                                                 |
| 2 / 2b / 2c | − giảm giá, + phụ thu, − VAT nằm trong giá (nếu giá đã gồm VAT)                     |
| **3**       | **Doanh thu thuần**                                                                 |
| 4           | − Giá vốn (phiếu xuất bán hàng, FIFO)                                               |
| **5**       | **Lãi gộp**                                                                         |
| 6, 7        | − hao hụt kiểm kê (thiếu − thừa), − xuất huỷ                                        |
| **8**       | **Lợi nhuận sau kiểm kê**                                                           |
| 9, 10, 11   | − chiết khấu app, − dùng nội bộ, − chi phí chung                                    |
| **12**      | **Lợi nhuận ròng** (được âm — hiển thị "Lỗ")                                        |
| 13, 14      | − thuế GTGT, − thuế TNCN tạm tính (chỉ hộ kinh doanh)                               |
| **15**      | **Lợi nhuận sau thuế** (khi có dòng 13, 14, dòng 12 đổi tên "Lợi nhuận trước thuế") |

Thuế hộ kinh doanh tính **luỹ kế từ tháng 1** (chi tiết: `ap-dung-thue-trong-app.md`). Với TNCN theo lãi, tháng lỗ
làm giảm thuế đã tính cho các tháng trước nên thuế của tháng đó có thể **âm**; báo cáo ghi rõ "điều chỉnh luỹ kế".
Tổng 12 tháng luôn bằng thuế cả năm.

Trạng thái tháng: _Tạm tính_, _Chưa kiểm kê_, _Thiếu chi phí chung_, _Còn nợ kho_, _Đã chốt_.

**Khoá sổ** tháng M cần: tháng trước đã khoá (nếu có dữ liệu), không còn đơn mở, không còn nợ kho, mọi ngày bán đã chốt ngày.
Khoá = lưu snapshot (`monthly_closings`) → báo cáo đọc snapshot; mọi thao tác ghi vào tháng đã khoá bị chặn. Mở khoá chỉ tháng khoá gần nhất, có lý do, xoá snapshot.

Kiểm tra chéo trong báo cáo "Lãi theo món": Σ lãi sau kiểm kê các món + phụ thu − hao hụt chung − xuất huỷ − chiết khấu app − nội bộ − chi phí chung = lợi nhuận ròng.

## Quyền

|                                                              | ADMIN | STAFF                      | KITCHEN       |
| ------------------------------------------------------------ | ----- | -------------------------- | ------------- |
| Bán hàng, chốt ngày                                          | ✓     | ✓                          |               |
| Màn hình bếp / bar                                           | ✓     | ✓                          | trạm của mình |
| Phiếu nhập / xuất, kiểm kê nháp                              | ✓     | ✓                          |               |
| Chốt / huỷ kiểm kê, thực đơn, giá, báo cáo, cài đặt, khoá sổ | ✓     |                            |               |
| Sao lưu dữ liệu, Google Drive, Telegram                      | ✓     |                            |               |
| Thấy giá vốn / lãi                                           | ✓     | (API tự bỏ các trường này) |               |

## Sao lưu dữ liệu

- API tự `pg_dump` toàn bộ database lúc `backup_hour` (mặc định 02:00) vào `BACKUP_DIR`, giữ 30 bản mới nhất.
  Máy tắt lúc đó → chạy khi bật lại; lần lỗi được thử lại mỗi giờ. File sao lưu phải bắt đầu bằng `PGDMP`
  và đủ lớn, nếu không coi là lỗi và xoá.
- Đã kết nối Google Drive và đang bật "Gửi lên Google Drive" → tải bản vừa tạo lên thư mục
  _Kế toán quán - Sao lưu dữ liệu_, giữ 30 bản mới nhất ở đó. Lỗi Drive không làm mất bản trên máy.
- Đã chọn cuộc trò chuyện Telegram và đang bật "Gửi qua Telegram" → bot gửi file vào đó (tối đa 50 MB). Lỗi gửi
  không làm mất bản trên máy.
- "Gửi cả ảnh / file chứng từ": sau mỗi lần sao lưu, gửi các file chứng từ chưa gửi theo thứ tự tải lên, mỗi file
  một lần (nhớ vị trí đã gửi), tối đa 100 file / lần, cách nhau ~3 giây; lỗi thì dừng, lần sau gửi tiếp. Đổi
  cuộc trò chuyện → gửi lại từ đầu.
- Cảnh báo khi: chưa có bản nào, lần gần nhất lỗi, bản thành công gần nhất cũ hơn 2 ngày, hoặc chưa gửi được lên
  Drive / qua Telegram.
- Google Client ID / secret nhập trong Cài đặt (secret mã hoá, không gửi ra trình duyệt); đổi Client ID thì kết
  nối Drive cũ bị ngắt.
