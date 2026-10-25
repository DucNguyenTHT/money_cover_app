# Áp dụng thuế trong app — nghiên cứu và đề xuất

_Đối chiếu cách app đang xử lý thuế với quy định hiện hành, chỉ ra chỗ còn thiếu và đề xuất các bước làm — cập nhật 10/2026. Quy định thuế xem ở [thue-gtgt-viet-nam.md](thue-gtgt-viet-nam.md)._

> **Tóm tắt**
>
> - App đã tính **VAT trên bill** đúng cho trường hợp **công ty khấu trừ thuế**: thuế suất lưu theo từng đơn, hỗ trợ giá đã gồm / chưa gồm VAT, phí phục vụ cũng chịu VAT, VAT không bị tính vào doanh thu.
> - App **chưa hỗ trợ hộ kinh doanh** — trường hợp phổ biến nhất của quán ăn: không tính thuế GTGT + TNCN phải nộp theo doanh thu, không theo dõi ngưỡng 1 tỷ, không có báo cáo kê khai theo quý.
> - Với công ty, app **chưa ghi thuế đầu vào**, nên chưa ra được số thuế GTGT phải nộp.
> - Đề xuất làm theo 3 giai đoạn. **Giai đoạn 1 (hộ kinh doanh + báo cáo thuế) đã làm xong ngày 17/10/2026** — xem [mục 5](#5-giai-đoạn-1-đã-làm-17102026).

## Mục lục

1. [Hiện trạng trong app](#1-hiện-trạng-trong-app)
2. [Đối chiếu với quy định — chỗ còn thiếu](#2-đối-chiếu-với-quy-định--chỗ-còn-thiếu)
3. [Đề xuất theo giai đoạn](#3-đề-xuất-theo-giai-đoạn)
4. [Thiết kế sơ bộ](#4-thiết-kế-sơ-bộ)
5. [Giai đoạn 1 đã làm (17/10/2026)](#5-giai-đoạn-1-đã-làm-17102026)
6. [Câu trả lời của chủ quán](#6-câu-trả-lời-của-chủ-quán)
7. [Giai đoạn 3 đã làm phần chung (25/10/2026)](#7-giai-đoạn-3-đã-làm-phần-chung-25102026)

## 1. Hiện trạng trong app

| Nội dung                     | App đang làm                                                                                                                                          | Ở đâu trong mã nguồn                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Cài đặt thuế                 | 1 ô **Thuế VAT (%)** (mặc định 0) và **Cách tính VAT**: cộng thêm vào bill / đã gồm trong giá; phụ thu (phí phục vụ) theo kênh                        | `settings`: `vat_pct`, `vat_mode`, `service_charge_pct`   |
| Thuế suất theo đơn           | Lấy thuế suất trong cài đặt **lúc mở đơn** và lưu vào đơn → đổi cài đặt không làm sai đơn cũ                                                          | `orders.vat_pct`, `orders.vat_mode` (`orders.service.ts`) |
| Tính tiền thuế               | Giảm giá trừ trước khi tính thuế; **phí phục vụ cũng chịu VAT**; giá đã gồm VAT thì tách ngược `giá × % ÷ (100 + %)`; làm tròn đến đồng theo từng đơn | `domain/orders/totals.ts`                                 |
| Doanh thu                    | **Doanh thu thuần không gồm VAT** (VAT là tiền thu hộ)                                                                                                | `orders.net_revenue`                                      |
| Bill in                      | Có dòng "VAT x%" hoặc "Gồm VAT x%"                                                                                                                    | `modules/orders/print.ts`                                 |
| Báo cáo lãi lỗ               | Dòng "VAT tách khỏi giá" (khi giá đã gồm VAT) và dòng ghi nhớ **"VAT đã thu"** — không cộng vào doanh thu                                             | `domain/period/pnl.ts`                                    |
| Báo cáo ngày / danh sách đơn | Có cột tiền VAT                                                                                                                                       | `prisma/sql/reportDaily.sql`, `reportOrders.sql`          |
| Chứng từ mua bán             | Lưu ảnh hoá đơn, số hoá đơn, đối tác, **số tiền** — chưa có cột tiền thuế                                                                             | `documents`                                               |
| Phiếu nhập kho               | Lưu số lượng, đơn giá, thành tiền — **chưa có thuế suất / tiền thuế đầu vào**; giá vốn FIFO dùng đúng giá trên phiếu                                  | `receipts`, `receipt_items`, `lots`                       |

## 2. Đối chiếu với quy định — chỗ còn thiếu

| #   | Chỗ còn thiếu                                                                                                                                                                             | Ảnh hưởng                                                                                                               | Áp dụng cho   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------- |
| G1  | **Chưa có "loại hình nộp thuế"** (hộ kinh doanh / công ty khấu trừ). App chỉ có ô VAT %.                                                                                                  | Dễ cài sai: hộ kinh doanh bật VAT trên bill là sai (hộ không được ghi thuế suất trên hoá đơn bán hàng).                 | Cả hai        |
| G2  | **Không ước tính thuế phải nộp của hộ kinh doanh**: thuế GTGT = doanh thu × 3% (2,4% đến hết 2026), thuế TNCN = (doanh thu − 1 tỷ) × 1,5% hoặc theo lãi.                                  | "Lợi nhuận ròng" trong báo cáo **cao hơn thực tế** vì chưa trừ thuế. Ví dụ doanh thu 1,8 tỷ/năm: thiếu khoảng 55 triệu. | Hộ kinh doanh |
| G3  | **Không theo dõi ngưỡng 1 tỷ đồng/năm** (doanh thu cộng dồn từ 1/1).                                                                                                                      | Không biết lúc nào bắt đầu phải nộp thuế; vượt ngưỡng phải đăng ký hoá đơn điện tử trong 30 ngày.                       | Hộ kinh doanh |
| G4  | **Không có báo cáo phục vụ kê khai theo quý / năm** (doanh thu chịu thuế, thuế GTGT, thuế TNCN theo kỳ).                                                                                  | Phải tự cộng từ báo cáo tháng.                                                                                          | Cả hai        |
| G5  | **Thuế suất là 1 ô cố định.** Mức 8% chỉ đến hết 31/12/2026; tỷ lệ hộ kinh doanh 2,4% cũng vậy.                                                                                           | Phải nhớ đổi tay đúng 0h ngày 1/1/2027; đơn mở trước 0h và thanh toán sau 0h vẫn mang thuế suất cũ.                     | Cả hai        |
| G6  | **Không ghi thuế GTGT đầu vào** (trên phiếu nhập hoặc chứng từ mua vào), không đánh dấu "có hoá đơn GTGT" / "đã chuyển khoản".                                                            | Công ty không tính được **thuế phải nộp = đầu ra − đầu vào**; giá vốn đang gồm cả phần thuế được khấu trừ.              | Công ty       |
| G7  | **Chưa xuất hoá đơn điện tử** (khởi tạo từ máy tính tiền). Bill in nhiệt hiện tại không phải hoá đơn.                                                                                     | Bắt buộc với hộ kinh doanh doanh thu trên 1 tỷ và với công ty; hiện phải dùng phần mềm hoá đơn riêng song song.         | Cả hai        |
| G8  | **Chi phí chưa tách "có chứng từ hợp lệ"** — cần cho hộ kinh doanh chọn tính TNCN theo lãi (doanh thu − chi phí hợp lý).                                                                  | Số lãi trong app có thể khác "lãi tính thuế".                                                                           | Hộ kinh doanh |
| G9  | **Kênh app giao hàng:** app đang áp VAT cho cả đơn kênh App như đơn tại quán. Cần xác định doanh thu tính thuế là giá bán cho khách hay số tiền app trả về, và ai xuất hoá đơn cho khách. | Có thể tính thừa / thiếu thuế phần đơn app.                                                                             | Cả hai        |

## 3. Đề xuất theo giai đoạn

### Giai đoạn 1 — Hộ kinh doanh và báo cáo thuế (nên làm trước)

Không cần đổi database (cài đặt lưu dạng JSON), chỉ thêm logic tính và màn hình.

1. **Cài đặt "Loại hình nộp thuế"** trong _Hệ thống → Cài đặt_:
   - **Hộ kinh doanh (tỷ lệ % trên doanh thu)** — tự khoá VAT trên bill = 0; hiện tỷ lệ GTGT / TNCN theo ngành (mặc định ăn uống 3% / 1,5%), cách tính TNCN (theo doanh thu / theo lãi).
   - **Công ty (khấu trừ thuế)** — giữ ô VAT % và cách tính như hiện nay.
2. **Lịch thuế suất theo ngày** thay cho 1 ô cố định: ví dụ VAT 8% từ 01/07/2025, 10% từ 01/01/2027; mức giảm 20% tỷ lệ của hộ kinh doanh đến 31/12/2026. Đơn lấy thuế suất theo **ngày kinh doanh lúc thanh toán**. Thông báo nhắc trước 30 ngày khi sắp đổi mức.
3. **Báo cáo "Thuế phải nộp"** (_Báo cáo → Tài chính_), chọn tháng / quý / năm:
   - Hộ kinh doanh: doanh thu kỳ, doanh thu cộng dồn năm, thuế GTGT, thuế TNCN (tạm tính, quyết toán theo năm), **tổng thuế phải nộp**, hạn nộp tờ khai.
   - Công ty: VAT đầu ra theo thuế suất (đầu vào bổ sung ở giai đoạn 2).
   - Xuất Excel để đưa kế toán.
4. **Dòng "Thuế (ước tính)" trong báo cáo lãi lỗ** → thêm dòng **"Lợi nhuận sau thuế"**; số liệu được chụp lại khi khoá sổ tháng như các dòng khác.
5. **Cảnh báo ngưỡng 1 tỷ** trên bảng điều khiển và chuông thông báo khi doanh thu cộng dồn năm đạt 80% và 100% ngưỡng, kèm việc cần làm (đăng ký hoá đơn điện tử trong 30 ngày, bắt đầu khai thuế quý).

### Giai đoạn 2 — Công ty: thuế đầu vào và thuế GTGT phải nộp

1. **Phiếu nhập kho:** thêm thuế suất GTGT (0 / 5 / 8 / 10%) và tiền thuế cho từng dòng; cờ "có hoá đơn GTGT"; cờ "đã chuyển khoản" (bắt buộc với khoản từ 5 triệu đồng).
2. **Chứng từ:** thêm cột tiền thuế GTGT cho chứng từ mua vào không qua kho (điện, gas, internet, sửa chữa…), liên kết với ảnh hoá đơn đã lưu.
3. **Giá vốn FIFO dùng giá chưa thuế** khi thuế đầu vào được khấu trừ (thuế không khấu trừ được thì cộng vào giá vốn) — thay đổi lớn, ảnh hưởng giá thành món, cần thống nhất trước.
4. Báo cáo thuế: **Thuế GTGT phải nộp = Đầu ra − Đầu vào đủ điều kiện**, kèm bảng kê hoá đơn mua vào / bán ra; cảnh báo hoá đơn mua vào thiếu điều kiện khấu trừ.

### Giai đoạn 3 — Hoá đơn điện tử khởi tạo từ máy tính tiền

- Tích hợp API của **một nhà cung cấp hoá đơn điện tử** (chủ quán chọn): khi thanh toán, app gửi dữ liệu đơn, nhận mã của cơ quan thuế, in mã tra cứu / QR lên bill.
- Cần: hợp đồng với nhà cung cấp, đăng ký sử dụng hoá đơn với cơ quan thuế, kết nối Internet ổn định ở quán (hiện app chạy được khi mất mạng — cần hàng đợi gửi lại).
- Chưa nghiên cứu chi tiết API và chi phí từng nhà cung cấp; làm khi chủ quán đã chọn.

### Mức độ và thứ tự

| Việc                                                 | Giai đoạn | Công sức ước lượng | Cần đổi database                    |
| ---------------------------------------------------- | --------- | ------------------ | ----------------------------------- |
| Loại hình nộp thuế + tỷ lệ hộ kinh doanh             | 1         | Nhỏ                | Không (cài đặt JSON)                |
| Lịch thuế suất theo ngày                             | 1         | Nhỏ                | Không                               |
| Báo cáo thuế phải nộp + xuất Excel                   | 1         | Vừa                | Không                               |
| Dòng thuế ước tính / lợi nhuận sau thuế trong lãi lỗ | 1         | Nhỏ                | Không (snapshot JSON đã có)         |
| Cảnh báo ngưỡng 1 tỷ                                 | 1         | Nhỏ                | Không                               |
| Thuế đầu vào trên phiếu nhập / chứng từ              | 2         | Vừa                | Có (thêm cột)                       |
| Giá vốn theo giá chưa thuế                           | 2         | Lớn                | Có, ảnh hưởng FIFO và giá thành món |
| Hoá đơn điện tử máy tính tiền                        | 3         | Lớn                | Có + tích hợp bên ngoài             |

## 4. Thiết kế sơ bộ

**Cài đặt** (bảng `settings`, dạng JSON — không cần migration):

```json
{
  "tax_regime": "HOUSEHOLD",
  "household_tax": {
    "vat_rate": 3,
    "pit_rate": 1.5,
    "pit_method": "REVENUE",
    "threshold": 1000000000,
    "reductions": [{ "from": "2025-07-01", "to": "2026-12-31", "vat_rate_cut_pct": 20 }]
  },
  "vat_schedule": [
    { "from": "2025-07-01", "pct": 8 },
    { "from": "2027-01-01", "pct": 10 }
  ]
}
```

**Logic thuần** (`apps/api/src/domain/tax/`, có unit test, dùng chung cho báo cáo và bảng điều khiển):

```text
householdTax(doanhThuKỳ, doanhThuCộngDồnNăm, cấuHình, ngày) →
  vat = doanhThuKỳ × tỷLệGTGT(ngày)              — 0 nếu cả năm ≤ ngưỡng
  pit = (doanhThuNăm − ngưỡng) × tỷLệTNCN         — cách theo doanh thu
      | (doanhThuNăm − chiPhíHợpLý) × 15/17/20%    — cách theo lãi
  tổng = vat + pit
vatRateOn(ngày, lịchThuếSuất) → thuế suất áp dụng cho đơn
```

**Báo cáo:** thêm 1 file TypedSQL tổng doanh thu theo tháng của năm (đã có sẵn số liệu `orders.net_revenue`, `vat_amount`); phần tính thuế làm ở domain như báo cáo lãi lỗ hiện nay.

**Lưu ý kỹ thuật:**

- Ngưỡng 1 tỷ xét theo **cả năm dương lịch**: giữa năm chỉ tạm tính; tháng nào doanh thu cộng dồn vượt ngưỡng thì từ đó báo "phải nộp".
- Thuế ước tính của tháng đã khoá sổ phải chụp lại trong `monthly_closings` để số cũ không đổi khi cài đặt thay đổi.
- Giai đoạn 1 không đổi cách tính tiền trên bill; chỉ thêm báo cáo, nên không ảnh hưởng đơn đã bán.

## 5. Giai đoạn 1 đã làm (17/10/2026)

| Phần                     | Đã làm                                                                                                                                                                                                                                                                                                      | Ở đâu                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Loại hình nộp thuế       | _Hệ thống → Cài đặt → Thuế & phụ thu_: **Hộ kinh doanh** (mặc định) / **Công ty (khấu trừ thuế)**. Hộ kinh doanh: chọn cách tính thuế TNCN (theo lãi / theo doanh thu), công tắc "đã đăng ký hoá đơn điện tử máy tính tiền".                                                                                | `settings`: `tax_regime`, `household_pit_method`, `einvoice_registered` |
| Bill của hộ kinh doanh   | Đơn mới luôn có VAT = 0, dù ô "Thuế VAT (%)" còn số cũ (ô này chỉ hiện khi chọn Công ty). Đơn đã bán không đổi.                                                                                                                                                                                             | `modules/orders/orders.service.ts`                                      |
| Ngành thuế theo nhóm món | Mỗi nhóm món chọn ngành: ăn uống (3% / 1,5%, mặc định), phân phối hàng hoá (1% / 0,5%), dịch vụ (5% / 2%), khác (2% / 1%). Doanh thu (gồm phụ thu) chia cho các ngành theo tỷ lệ tiền món.                                                                                                                  | Cột `dish_categories.tax_group` (migration nhỏ, có mặc định)            |
| Tính thuế                | Hàm thuần, tính **luỹ kế từ tháng 1** nên 12 tháng cộng lại đúng bằng thuế cả năm: GTGT trên toàn bộ doanh thu khi luỹ kế vượt 1 tỷ (tháng vượt ngưỡng gánh phần của các tháng trước), giảm 20% đến 31/12/2026; TNCN theo lãi luỹ kế × 15 / 17 / 20% hoặc (doanh thu − 1 tỷ) × tỷ lệ ngành. Có 9 unit test. | `domain/tax/household.ts`                                               |
| Báo cáo lãi lỗ           | Thêm dòng 13 **Thuế GTGT phải nộp (tạm tính)**, 14 **Thuế TNCN phải nộp (tạm tính)**, 15 **Lợi nhuận sau thuế**; dòng 12 đổi tên "Lợi nhuận trước thuế". Khoá sổ tháng lưu luôn số thuế, mở lại báo cáo không đổi.                                                                                          | `domain/period/pnl.ts`, `modules/reports`                               |
| Báo cáo "Thuế phải nộp"  | _Báo cáo → Thuế phải nộp_: chọn năm; doanh thu luỹ kế, tháng vượt ngưỡng, thuế GTGT / TNCN theo tháng, theo quý kèm **hạn nộp tờ khai**, theo ngành; giải thích công thức; xuất Excel / CSV.                                                                                                                | `GET /api/reports/tax`, `features/reports/TaxReportPage.tsx`            |
| Cảnh báo                 | Chuông thông báo: doanh thu năm đạt 80% ngưỡng 1 tỷ; đã vượt mà chưa bật "đã đăng ký hoá đơn điện tử".                                                                                                                                                                                                      | `components/alerts.tsx`                                                 |

**Chưa làm trong giai đoạn 1:** lịch thuế suất theo ngày cho **công ty** (8% → 10% từ 2027) — quán là hộ kinh doanh nên chưa cần; mức giảm 20% của hộ kinh doanh đã tự hết hạn theo ngày trong mã nguồn.

**Lưu ý khi dùng:**

- Số thuế là **tạm tính** từ dữ liệu trong app. "Lãi" dùng để tính TNCN là _lợi nhuận trước thuế_ trong báo cáo lãi lỗ — gồm mọi chi phí đã nhập (giá vốn, hao hụt, chiết khấu app, chi phí chung), chưa tách chi phí có / không có chứng từ hợp lệ (điểm G8). Thuế GTGT chưa được trừ khỏi lãi khi tính TNCN — cần kế toán xác nhận.
- Tháng khoá sổ **trước** khi có tính năng này không có số thuế lưu sẵn — báo cáo tính lại theo cài đặt hiện tại.
- Mẹo: lưu ảnh hoá đơn mua vào ở mục **Chứng từ** để có sẵn khi kê khai hoặc khi cơ quan thuế kiểm tra.

## 6. Câu trả lời của chủ quán

| Câu hỏi              | Trả lời (17/10/2026)                                        | Đã áp dụng                                                                 |
| -------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| Loại hình, doanh thu | Doanh thu năm trên 1 tỷ; tính thuế TNCN → **hộ kinh doanh** | Mặc định "Hộ kinh doanh"                                                   |
| Ngành nghề           | Dịch vụ ăn uống, có thể thêm ngành khác                     | Ngành thuế theo nhóm món                                                   |
| Cách tính thuế TNCN  | **Theo lãi**                                                | Mặc định "Theo lãi"                                                        |
| Đơn app giao hàng    | Quán tự thu, quán tự xuất bill                              | Doanh thu tính thuế = toàn bộ giá bán; chiết khấu app là chi phí (G9 xong) |
| Hoá đơn điện tử      | Chưa dùng                                                   | Cảnh báo bắt buộc (doanh thu đã trên 1 tỷ); tích hợp ở giai đoạn 3         |
| Làm giai đoạn 1      | Có                                                          | Đã làm                                                                     |

## 7. Giai đoạn 3 đã làm phần chung (25/10/2026)

Chủ quán chưa chọn nhà cung cấp, nên app làm **toàn bộ phần không phụ thuộc nhà cung cấp** và cho chọn nhà cung cấp
trong _Hệ thống → Cài đặt → Hoá đơn điện tử_:

| Lựa chọn             | Ý nghĩa                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tắt                  | Không xuất hoá đơn                                                                                                                               |
| Giả lập (để thử)     | Hoá đơn giả (số `GL…`, bill ghi "giả lập"), không gửi cơ quan thuế — thử cả quy trình trước khi ký hợp đồng                                      |
| SePay eInvoice       | API công khai, có môi trường thử; SePay nối tới nhà cung cấp hoá đơn bạn đăng ký với họ (link PDF mẫu trong tài liệu của họ trỏ tới M-Invoice)   |
| Viettel, MISA, VNPT… | Chưa có: các bên này không công bố tài liệu API — khi chọn, xin tài liệu + tài khoản thử, thêm một adapter trong `modules/einvoice/providers.ts` |

**Đã làm:**

- Hai chế độ: _Mọi đơn khi thanh toán_ (đúng cho hộ kinh doanh trên 1 tỷ dùng hoá đơn máy tính tiền) hoặc _Chỉ khi khách lấy_.
- Màn thanh toán: ô thông tin người mua (tên, MST, địa chỉ, email) khi khách lấy hoá đơn có tên; MST được kiểm tra dạng.
- Nội dung hoá đơn dựng từ đơn (`domain/einvoice/document.ts`): từng món với giảm giá trên dòng, dòng phụ thu; hộ kinh doanh
  → hoá đơn bán hàng không ghi thuế suất; công ty → thuế suất của đơn, tiền thuế chia đúng đến đồng. Tổng luôn bằng số khách trả.
- Hàng đợi `einvoices`: ghi cùng transaction với thanh toán; worker gửi, theo dõi mã tracking tới khi phát hành; mất mạng → chờ
  và thử lại (1–5–15–60 phút), quá 3 ngày thì báo lỗi. Mỗi lần gửi kèm mã tham chiếu riêng → gửi lại không bao giờ ra hai hoá đơn.
- Sau khi thanh toán, app chờ tối đa vài giây để bill in kèm **số hoá đơn + QR tra cứu**; chưa kịp thì bill ghi "đang phát hành",
  in lại sau sẽ có số.
- Huỷ đơn đã phát hành → hoá đơn **điều chỉnh giảm toàn bộ**; huỷ khi chưa gửi → bỏ hoá đơn đó.
- Bị nhà cung cấp từ chối → cảnh báo Telegram + chuông; _Kế toán → Hoá đơn điện tử_ liệt kê theo ngày, gửi lại; chi tiết đơn có nút
  _Xuất hoá đơn_ cho đơn chưa có.

**Lưu ý pháp lý (cập nhật 10/2026):** Nghị định 254/2026/NĐ-CP và Thông tư 91/2026/TT-BTC (hiệu lực 01/7/2026) đưa dịch vụ ăn uống
bán trực tiếp cho người tiêu dùng vào diện dùng hoá đơn khởi tạo từ máy tính tiền; hộ đã đăng ký hoá đơn có mã / không mã không bắt
buộc chuyển; hoá đơn sai phải lập **hoá đơn thay thế** (cho phép gộp một hoá đơn điều chỉnh / thay thế kèm bảng kê cho nhiều hoá
đơn cùng khách trong tháng). App hiện dùng **điều chỉnh giảm** khi huỷ đơn — cần nhà cung cấp / kế toán xác nhận cách đúng với
loại hoá đơn của quán trước khi dùng thật.
