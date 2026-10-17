# Quy tắc nghiệp vụ

Các công thức nằm trong `apps/api/src/domain` (có unit test). Tài liệu này giải thích _vì sao_ và _khi nào_.

## Tiền, ngày

- Tiền là **số nguyên đồng**; mỗi bước tính đều làm tròn về đồng. Khi chia một khoản cho nhiều dòng (giảm giá đơn, hao hụt), phần dư dồn cho các dòng có phần lẻ lớn nhất → tổng luôn khớp tuyệt đối.
- **Ngày kinh doanh** theo `business_day_start` (mặc định 04:00): đơn lúc 01:30 sáng ngày 12 thuộc ngày 11.

## Đơn hàng

| Bước             | Quy tắc                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Giá              | Theo kênh và ngày kinh doanh của đơn: tại quán / mang về dùng giá `STORE`, app dùng giá `APP`. Nhân viên không sửa giá, chỉ giảm giá                                                  |
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

| Chỉ tiêu             | Công thức                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| Giá vốn trực tiếp    | Σ định mức × giá nhập gần nhất (+ bao bì nếu mang về / app)                                     |
| Chi phí chung / phần | giá bán × tỷ lệ chi phí chung (AUTO = chi phí chung 3 tháng trước ÷ doanh thu thuần 3 tháng đó) |
| Giá gợi ý tại quán   | giá vốn ÷ % food cost mục tiêu, làm tròn lên                                                    |
| Giá gợi ý app        | giữ nguyên lãi ròng / phần như tại quán sau chiết khấu app                                      |
| Cảnh báo             | food cost ≥ 100% → "Đang lỗ"; vượt mục tiêu + ngưỡng → "Vượt mục tiêu"                          |

## Lãi lỗ tháng

Tháng là đơn vị chốt; quý / năm luôn bằng tổng các tháng.

| #           | Dòng                                                            |
| ----------- | --------------------------------------------------------------- |
| 1           | Doanh thu bán hàng (trước giảm giá)                             |
| 2 / 2b / 2c | − giảm giá, + phụ thu, − VAT nằm trong giá (nếu giá đã gồm VAT) |
| **3**       | **Doanh thu thuần**                                             |
| 4           | − Giá vốn (phiếu xuất bán hàng, FIFO)                           |
| **5**       | **Lãi gộp**                                                     |
| 6, 7        | − hao hụt kiểm kê (thiếu − thừa), − xuất huỷ                    |
| **8**       | **Lợi nhuận sau kiểm kê**                                       |
| 9, 10, 11   | − chiết khấu app, − dùng nội bộ, − chi phí chung                |
| **12**      | **Lợi nhuận ròng** (được âm — hiển thị "Lỗ")                    |

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
| Thấy giá vốn / lãi                                           | ✓     | (API tự bỏ các trường này) |               |
