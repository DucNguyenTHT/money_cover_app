# Quy tắc nghiệp vụ

Các công thức nằm trong `apps/api/src/domain` (có unit test). Tài liệu này giải thích _vì sao_ và _khi nào_.

## Tiền, ngày

- Tiền là **số nguyên đồng**; mỗi bước tính đều làm tròn về đồng. Khi chia một khoản cho nhiều dòng (giảm giá đơn, hao hụt), phần dư dồn cho các dòng có phần lẻ lớn nhất → tổng luôn khớp tuyệt đối.
- **Ngày kinh doanh** theo `business_day_start` (mặc định 04:00): đơn lúc 01:30 sáng ngày 12 thuộc ngày 11.

## Đơn hàng

| Bước             | Quy tắc                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Giá              | Theo kênh và ngày kinh doanh của đơn: tại quán / mang về dùng giá `STORE`; đơn app dùng giá riêng của app đó → giá app chung → giá tại quán. Nhân viên không sửa giá, chỉ giảm giá    |
| Tổng tiền        | tạm tính − giảm giá món − khuyến mãi − giảm giá đơn − đổi điểm = doanh số → + phụ thu (chỉ kênh được cài) → + VAT (`EXCLUSIVE`) hoặc tách VAT ra khỏi giá (`INCLUSIVE`)               |
| Doanh thu thuần  | doanh số + phụ thu, **không gồm VAT** (VAT là tiền thu hộ, báo riêng)                                                                                                                 |
| Giảm giá         | Bắt lý do. Vượt `max_discount_pct` cần ADMIN nhập PIN; lưu người duyệt                                                                                                                |
| Gửi bếp          | Món mới chia theo trạm của nhóm món (Bếp / Bar). Món đã gửi chỉ **huỷ** được (có lý do, hỏi đã chế biến chưa)                                                                         |
| Thanh toán       | Tổng các hình thức phải bằng số cần trả. Trừ kho FIFO theo định mức (bao bì chỉ khi mang về / app). Thiếu hàng vẫn bán → **nợ kho**                                                   |
| Bán dưới giá vốn | Doanh thu thuần < giá vốn → bắt lý do trước khi thanh toán                                                                                                                            |
| Huỷ đơn          | Không xoá: chuyển "Đã huỷ" + lý do. Đơn mở / đã trả trong ngày: nhân viên được huỷ. Ngày trước hoặc ngày đã chốt: cần ADMIN (PIN). Đã trả → hoàn lô; món đã chế biến → phiếu xuất huỷ |
| Đồng thời        | Mỗi lần sửa đơn gửi kèm `version`; máy khác đã sửa trước → 409, POS tải lại đơn                                                                                                       |

## Tuỳ chọn món (size, topping, yêu cầu)

- **Nhóm tuỳ chọn** dùng chung cho nhiều món: chọn 1 (size) hoặc chọn nhiều (topping, yêu cầu), có thể bắt buộc,
  giới hạn số lựa chọn, có lựa chọn chọn sẵn. Món dùng các nhóm được gắn ở _Sửa món → Tuỳ chọn_.
- **Giá dòng** = giá món (theo kênh / app) + tiền các tuỳ chọn (giống nhau mọi kênh).
- **Kho:** hệ số định mức của tuỳ chọn (size Lớn ×1,5) nhân các dòng định mức _mọi kênh_ (bao bì giữ 1 / phần);
  nguyên liệu của tuỳ chọn (Thêm trứng → 1 quả) cộng thêm mỗi phần. Giá vốn món, hao hụt kiểm kê tính cả phần này.
- **Bản chụp:** tên, giá, hệ số và nguyên liệu của tuỳ chọn được lưu vào dòng đơn lúc gọi; sửa / xoá tuỳ chọn
  sau đó không đổi đơn cũ. Tuỳ chọn đã bán bị bỏ khỏi nhóm chỉ bị ẩn.
- **POS:** món có nhóm bắt buộc chưa có lựa chọn chọn sẵn → mở bảng chọn; còn lại thêm ngay với lựa chọn chọn sẵn.
  Sửa tuỳ chọn được khi dòng chưa gửi bếp. Hai dòng chỉ gộp khi cùng món, cùng tuỳ chọn, cùng ghi chú, chưa giảm giá.
- Phiếu bếp / màn bếp / bill in tuỳ chọn dưới tên món. Báo cáo bán hàng có mục "Topping".

## Kho

- **FIFO theo lô**: mỗi dòng phiếu nhập là một lô với giá nhập riêng; xuất lấy lô cũ nhất trước. Lô bị khoá hàng (`SELECT … FOR UPDATE`) theo thứ tự để không trùng khi 2 máy thanh toán cùng lúc.
- **Nợ kho**: bán khi chưa nhập hàng → dòng xuất có `pending_qty`, tạm tính theo giá nhập gần nhất. Phiếu nhập sau đó **tất toán** nợ kho (cũ trước), giá vốn của đơn liên quan được tính lại.
- Phiếu nhập chỉ sửa / xoá được khi lô chưa bị dùng.
- **Cần nhập hàng:** lượng dùng / ngày = (xuất bán + dùng nội bộ + xuất huỷ) của 14 ngày trước hôm nay ÷ 14.
  Tồn dùng được = tồn − nợ kho. _Hết hàng_ khi tồn dùng được ≤ 0 (và có dùng gần đây hoặc có tồn tối thiểu);
  _Sắp hết_ khi dưới tồn tối thiểu hoặc không đủ dùng `reorder_days` ngày (mặc định 3). Gợi ý nhập = đủ
  max(tồn tối thiểu, lượng dùng × số ngày), làm tròn lên theo đơn vị mua (thùng, bao…).

## Bán thành phẩm (nước dùng, sốt…)

- Nguyên liệu loại **Bán thành phẩm** (vd _Nước dùng bò_, đơn vị lít, định mức ml) có **công thức một mẻ** theo ngày hiệu lực:
  nguyên liệu (đơn vị kho) → sản lượng một mẻ. Món dùng bán thành phẩm trong định mức như nguyên liệu thường.
- **Phiếu chế biến** (Kho → Chế biến): bán thành phẩm, số lượng **thu được thật**, ngày nấu, nguyên liệu (điền theo công thức
  rồi sửa được). Nguyên liệu xuất FIFO (phiếu xuất "Xuất chế biến"), phải **có trong kho vào ngày nấu** (nhập phiếu nhập trước);
  thành phẩm vào kho thành **một lô** giá vốn = tiền nguyên liệu ÷ số lượng thu được. Món bán trước khi ghi phiếu (nợ kho
  nước dùng) được tính lại giá vốn theo mẻ đó.
- Không lồng nhau: nguyên liệu chế biến không được là bán thành phẩm. Bán thành phẩm không nhập mua (tồn đầu thì được),
  không có trong _Cần nhập hàng_; có trong kiểm kê, phân bổ hao hụt vào món như nguyên liệu thường.
- **Giá vốn trong Bảng tính giá** = công thức × giá nhập mới nhất ÷ sản lượng một mẻ (giá xương tăng → món dùng nước dùng
  báo ngay); chưa có công thức thì lấy giá lô gần nhất.
- Xoá phiếu chế biến (có lý do): chỉ khi lô thành phẩm chưa dùng tới; hoàn nguyên liệu về đúng lô. Nhân viên xoá được phiếu
  mình tạo trong ngày, còn lại ADMIN. Phiếu xuất chế biến không xoá riêng được.
- Báo cáo Nhập – xuất – tồn có cột _Chế biến ra_ (thành phẩm) và _Đem chế biến_ (nguyên liệu); lãi lỗ không đổi (chế biến
  chỉ chuyển giá trị trong kho).

## Sổ quỹ tiền mặt

- Ghi tiền bỏ vào / lấy ra khỏi két **ngoài bán hàng**: tiền lẻ đầu ngày, chi chợ, nộp ngân hàng… Không ghi cho ngày
  tương lai, không ghi vào tháng đã khoá sổ.
- **Chốt ngày:** tiền mặt dự kiến = tiền mặt bán hàng (thu − thối) + thu sổ quỹ − chi sổ quỹ của ngày đó. Thêm / huỷ
  khoản của một ngày đã chốt → ngày đó "Cần chốt lại".
- Không xoá, chỉ **huỷ có lý do** (vẫn hiện, gạch ngang): người ghi được huỷ trong ngày, ADMIN huỷ bất cứ lúc nào.
- Khoản do màn hình khác tự ghi (trả nhà cung cấp, trả lương, tạm ứng bằng tiền mặt) chỉ huỷ ở màn hình đó.

## Tự xác nhận tiền chuyển khoản

Cần nối SePay hoặc Casso (Cài đặt › Tự xác nhận tiền chuyển khoản, hướng dẫn: `setup-bank-feed.md`). App đọc **tiền
vào** tài khoản mỗi phút (mỗi 4 giây với SePay / 30 giây với Casso khi có máy POS đang chờ tiền), mới nhất trước, dừng ở
giao dịch đã có; chỉ giữ giao dịch của tài khoản VietQR (hoặc tài khoản ghi trong cài đặt).

| Cách khớp    | Khi nào                                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Theo mã đơn  | Nội dung có mã đơn của ngày đó ±2 ngày; so **chữ và số** (bỏ dấu, dấu gạch, hoa thường); mã dài nhất thắng                   |
| Theo số tiền | Không có mã, đúng số tiền một máy POS đang chờ (màn thanh toán chuyển khoản đang mở, 3 phút) — chỉ khi **một** máy chờ số đó |
| Gán tay      | Nhân viên: khoản chưa gán của ngày hôm nay. ADMIN: mọi khoản, bỏ gán (lý do), bỏ qua tiền không phải bán hàng (lý do)        |

- Khớp tiền **không đổi doanh thu, sổ quỹ hay lãi lỗ** — chỉ để đối chiếu: đơn đã thanh toán có tiền chuyển khoản ghi
  ở POS so với tiền về khớp đơn đó → _đủ_, _thiếu_ (chưa thấy tiền), _thừa_ (trả hai lần, hoặc đơn đã huỷ mà khách đã
  chuyển — cần xem hoàn tiền).
- Gộp đơn: tiền đã về của đơn nguồn chuyển sang đơn đích. Đơn bị huỷ giữ khoản đã khớp để biết cần hoàn tiền.
- Chốt ngày hiện khung đối chiếu (không chặn chốt). Chuông và tin sáng: đơn thiếu tiền / khoản chưa gán của 30 ngày
  trước hôm nay, và lỗi đọc dịch vụ. Báo cáo chốt ngày trên Telegram có thêm dòng chuyển khoản.

## Hoá đơn điện tử

Bật ở Cài đặt › Hoá đơn điện tử (Giả lập để thử, hoặc SePay eInvoice). Chi tiết và lưu ý pháp lý: `ap-dung-thue-trong-app.md` mục 7.

- **Khi nào:** _Mọi đơn khi thanh toán_, hoặc _Chỉ khi khách lấy_ (thu ngân tích ô ở màn thanh toán). Người mua có tên / MST nhập
  ở màn thanh toán (MST 10 số, 10 số-3 số hoặc 12 số, phải có tên).
- **Một đơn một hoá đơn gốc**: gửi lại / bấm hai lần không tạo hoá đơn thứ hai (mã tham chiếu riêng mỗi lần gửi tới nhà cung cấp).
- **Hàng đợi:** tạo trong cùng transaction với thanh toán; gửi ngay (chờ ≤ 6 giây để bill in kèm số + QR tra cứu), còn lại gửi
  nền. Mất mạng → thử lại sau 1, 5, 15, 60 phút; quá 3 ngày → _bị từ chối_. Nhà cung cấp từ chối → cảnh báo, gửi lại với mã mới.
- **Huỷ đơn:** hoá đơn chưa gửi → huỷ; đã phát hành → hoá đơn **điều chỉnh giảm toàn bộ** (số tiền âm), tự gửi khi hoá đơn gốc đã phát hành.
- Hộ kinh doanh: hoá đơn bán hàng, không ghi thuế suất. Công ty: thuế suất của đơn, tiền thuế chia theo dòng đúng đến đồng.

## Khuyến mãi (giờ vàng, combo)

Thực đơn › Khuyến mãi (ADMIN). Khuyến mãi **tự áp** vào đơn đang mở, tính lại mỗi khi đơn thay đổi; lưu / tắt / xoá
khuyến mãi thì các đơn đang mở được tính lại ngay. Đơn đã thanh toán giữ nguyên.

- **Giờ vàng:** giảm % giá dòng (gồm tuỳ chọn) cho cả thực đơn, một số nhóm món hoặc một số món.
- **Combo:** bộ món (món × số phần) bán một giá. Đơn đủ món của bộ → tính giá combo, đủ 2 bộ tính 2 lần. Tiền giảm =
  giá món lẻ của bộ − giá combo, chia vào các dòng theo giá món; tuỳ chọn / topping vẫn cộng thêm. Màn sửa combo hiện
  giá lẻ, tiền khách được giảm, giá vốn và lãi gộp của bộ.
- **Khi nào chạy:** ngày bắt đầu / kết thúc và thứ trong tuần theo **ngày kinh doanh**; khung giờ theo **lúc gọi món**
  (món gọi 16:55 trong giờ vàng 14:00–17:00 vẫn được giảm khi thanh toán lúc 17:30; giờ bắt đầu sau giờ kết thúc = qua
  nửa đêm); chọn kênh (mặc định tại bàn + mang về, không gồm app).
- **Thứ tự:** combo trước (bộ giảm nhiều nhất trước), phần còn lại lấy giờ vàng có % cao nhất. Dòng đã **giảm giá tay**
  không được khuyến mãi (không giảm hai lần). Không giảm quá giá dòng.
- Tiền khuyến mãi lưu theo dòng (`order_items.promo_discount`, khuyến mãi nào) và tổng đơn (`orders.promo_discount_total`);
  doanh thu thuần, lãi theo món, lãi lỗ đều đã trừ. Báo cáo gộp vào _giảm giá_; **không** tính vào giới hạn giảm giá
  của nhân viên và không báo Telegram. Bill in từng dòng "KM …" và dòng "Khuyến mãi".
- Xoá được khi chưa đơn đã thanh toán nào dùng; đã dùng thì tắt (bill cũ giữ tên). Danh sách hiện số đơn và tiền đã giảm
  tháng này.

## Khách quen & tích điểm

- Khách nhận theo **số điện thoại** (một số một khách; lưu dạng 0xxxxxxxxx, nhập +84 / có dấu cách đều được). Tìm theo
  một phần số hoặc tên không dấu. Gắn khách vào đơn ở màn bán hàng (_Khách quen_), thêm khách mới ngay tại đó.
- Bật ở Cài đặt › Khách quen & tích điểm. **Tích điểm** khi thanh toán: doanh thu thuần ÷ `loyalty_earn_vnd` (làm tròn
  xuống, mặc định 10.000 ₫ = 1 điểm). Tắt tích điểm vẫn đếm lần ghé và tiền đã chi.
- **Đổi điểm** = giảm tiền trên đơn: điểm × `loyalty_point_value` (mặc định 500 ₫), tối thiểu `loyalty_min_redeem` điểm,
  tối đa `loyalty_max_redeem_pct`% số tiền sau giảm giá. Tính sau giảm giá đơn, trước phụ thu / VAT; chia vào các dòng
  như giảm giá đơn → doanh thu thuần, lãi theo món, lãi lỗ đều đã trừ. Báo cáo gộp vào _giảm giá_; không tính vào giới
  hạn giảm giá của nhân viên.
- Điểm chỉ bị trừ **lúc thanh toán** (khoá số dư, không đủ → 409). Bớt món làm phần đổi điểm vượt mức → bỏ đổi điểm, đổi
  lại. Đổi khách của đơn → bỏ đổi điểm. Gộp đơn: đơn đích chưa có khách thì nhận khách của đơn nguồn.
- **Huỷ đơn đã trả:** hoàn điểm đã đổi, trừ điểm đã tích, bớt một lần ghé và tiền đã chi. Số dư có thể âm nếu khách đã
  tiêu điểm của đơn bị huỷ.
- Mỗi lần cộng / trừ là một dòng lịch sử (tích, đổi, hoàn khi huỷ, chỉnh tay). ADMIN cộng / trừ tay có lý do.

## Nhà cung cấp & công nợ

- Phiếu nhập hàng gắn một nhà cung cấp theo tên (không phân biệt hoa thường; chưa có thì tự tạo). Phiếu trả ngay
  mà không ghi tên → nhà cung cấp "Mua lẻ".
- **Công nợ** = tổng các phiếu nhập − tổng đã trả (không tính lần trả đã huỷ). Âm = trả trước.
- Tạo phiếu: _Mua chịu_ (ghi nợ), _Tiền mặt từ két_ hoặc _Chuyển khoản / khác_; trả đủ hoặc một phần (không quá tổng
  phiếu). Trả tiền mặt → tự ghi chi "Trả nhà cung cấp" vào sổ quỹ.
- Mỗi phiếu "còn nợ" bao nhiêu: lần trả gắn với phiếu trả cho phiếu đó trước, còn lại trả các phiếu **cũ nhất trước**.
- Sửa phiếu: các lần trả đi theo phiếu (cả khi đổi nhà cung cấp). Xoá phiếu: các lần trả của phiếu bị huỷ (kèm khoản
  chi trong sổ quỹ). Không đổi phiếu đã trả tiền thành tồn đầu.
- Phiếu nhập có trước khi dùng công nợ được coi là đã trả (một dòng "Đã thanh toán trước khi dùng công nợ" mỗi nhà
  cung cấp, không huỷ được).

## Nhân viên, chấm công, bảng lương

- Nhân viên trả **theo giờ** (giờ công × lương giờ) hoặc **theo tháng** (lương cố định). Gắn tài khoản đăng nhập thì
  tự bấm _Vào ca / Ra ca_ trên máy bán hàng hoặc màn bếp.
- **Chấm công:** mỗi người mỗi ngày một dòng: ca được xếp và giờ vào / ra. Giờ công = giờ ra − giờ vào; giờ trước
  giờ bắt đầu ngày kinh doanh (hoặc giờ ra trước giờ vào) là sáng hôm sau (ca qua đêm). "Điền đủ ca" lấy giờ của ca
  cho các ngày đã xếp ca mà chưa chấm.
- **Bảng lương tháng:** lương = (giờ công × lương giờ, hoặc lương tháng) + thưởng − trừ; **còn trả** = lương − tạm
  ứng trong tháng. Tạm ứng tiền mặt tự ghi chi "Tạm ứng lương" vào sổ quỹ.
- **Chốt bảng lương:** giữ nguyên số liệu, ghi tổng lương vào **chi phí chung** tháng đó (khoản "Lương", ghi chú
  "Theo bảng lương tháng …"); nếu tháng đã có khoản "Lương" nhập tay thì nhắc để không tính hai lần. Đã chốt thì
  chấm công và tạm ứng của tháng không sửa được; mở lại (có lý do) gỡ khoản chi phí chung, chỉ khi chưa trả ai.
- **Trả lương** từng người sau khi chốt: tiền mặt → tự ghi chi "Trả lương" vào sổ quỹ. Huỷ trả (ADMIN, có lý do).

## Kiểm kê

- Tồn sổ sách tại ngày kiểm = Σ nhập (≤ ngày) − Σ xuất (≤ ngày, gồm nợ kho) − Σ thiếu của các lần kiểm trước.
- Chốt: **thiếu** → trừ lô FIFO; **thừa** → tạo lô mới giá nhập gần nhất (bù nợ kho trước).
- Giá trị thiếu / thừa **phân bổ vào món** theo lượng nguyên liệu mỗi món đã dùng từ sau ngày kiểm kê trước (hoặc từ ngày nhập tồn đầu, tính cả ngày đó). Không món nào dùng → "hao hụt chung".

## Giá thành & giá bán

| Chỉ tiêu             | Công thức                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Giá vốn trực tiếp    | Σ định mức × giá nhập gần nhất (+ bao bì nếu mang về / app)                                                                           |
| Chi phí chung / phần | giá bán × tỷ lệ chi phí chung (xem dưới)                                                                                              |
| Giá gợi ý tại quán   | giá vốn ÷ % food cost mục tiêu, làm tròn lên                                                                                          |
| Giá gợi ý app        | **mỗi app một giá**: giữ nguyên lãi ròng / phần như tại quán sau chiết khấu của app đó                                                |
| Cảnh báo             | giá vốn + chiết khấu ≥ giá bán (tại quán hoặc **bất kỳ app nào**) → "Đang lỗ"; % nguyên liệu vượt mục tiêu + ngưỡng → "Vượt mục tiêu" |

**Tuỳ chọn / topping.** Bảng tính giá và Cảnh báo giá tính lãi từng tuỳ chọn của món (tại quán):

- _Topping_ (hệ số định mức 1): giá cộng thêm so với nguyên liệu thêm → "Đang lỗ" khi nguyên liệu thêm ≥ giá cộng
  thêm, "Vượt mục tiêu" khi % nguyên liệu vượt mục tiêu + ngưỡng. Topping dùng chung nhiều món chỉ báo một lần.
- _Size_ (hệ số ≠ 1): xét **cả phần** cỡ đó: (giá món + cộng thêm) so với (giá vốn món × hệ số + nguyên liệu thêm).
- Tuỳ chọn miễn phí hoặc giảm giá (≤ 0 đ) không cảnh báo. Gợi ý giá cộng thêm = phần giá vốn tăng thêm ÷ % mục
  tiêu, làm tròn lên.

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

|                                                               | ADMIN | STAFF                           | KITCHEN       |
| ------------------------------------------------------------- | ----- | ------------------------------- | ------------- |
| Bán hàng, chốt ngày                                           | ✓     | ✓                               |               |
| Màn hình bếp / bar                                            | ✓     | ✓                               | trạm của mình |
| Phiếu nhập / xuất, kiểm kê nháp                               | ✓     | ✓                               |               |
| Sổ quỹ: ghi khoản thu chi                                     | ✓     | ✓ (huỷ: khoản mình, trong ngày) |               |
| Nhà cung cấp: xem công nợ, trả tiền                           | ✓     | ✓                               |               |
| Nhà cung cấp: thêm / sửa, huỷ lần trả                         | ✓     |                                 |               |
| Tiền chuyển khoản: xem, gán khoản chưa gán trong ngày         | ✓     | ✓                               |               |
| Tiền chuyển khoản: nối dịch vụ, bỏ gán, bỏ qua                | ✓     |                                 |               |
| Hoá đơn điện tử: xuất cho đơn, gửi lại                        | ✓     | ✓                               |               |
| Hoá đơn điện tử: chọn nhà cung cấp, xem danh sách             | ✓     |                                 |               |
| Khách quen: thêm / sửa, gắn vào đơn, đổi điểm                 | ✓     | ✓                               |               |
| Khách quen: cộng / trừ điểm tay                               | ✓     |                                 |               |
| Khuyến mãi: tạo / sửa / tắt                                   | ✓     |                                 |               |
| Nhân viên, chấm công, bảng lương, tạm ứng                     | ✓     |                                 |               |
| Tự vào ca / ra ca (tài khoản gắn với nhân viên)               | ✓     | ✓                               | ✓             |
| Chốt / huỷ kiểm kê, thực đơn, giá, báo cáo, cài đặt, khoá sổ  | ✓     |                                 |               |
| Sao lưu dữ liệu, Google Drive, Telegram, báo cáo qua Telegram | ✓     |                                 |               |
| Thấy giá vốn / lãi                                            | ✓     | (API tự bỏ các trường này)      |               |

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
- **Khôi phục ảnh chứng từ:** mỗi file đã gửi lưu lại mã file Telegram (`telegram_file_id`, nằm trong bản sao lưu
  database). Máy chủ thiếu file (thay máy, khôi phục dữ liệu) → Cài đặt › Telegram báo số file thiếu; bấm "Lấy lại"
  để tải về (bot tải được file ≤ 20 MB), mỗi file phải **khớp sha256** đã ghi lúc tải lên. Ảnh thu nhỏ không gửi
  lên Telegram nên được bỏ (hiện ảnh gốc). File gửi trước khi có tính năng này không có mã → không lấy lại được.
- Cảnh báo khi: chưa có bản nào, lần gần nhất lỗi, bản thành công gần nhất cũ hơn 2 ngày, hoặc chưa gửi được lên
  Drive / qua Telegram.
- Google Client ID / secret nhập trong Cài đặt (secret mã hoá, không gửi ra trình duyệt); đổi Client ID thì kết
  nối Drive cũ bị ngắt.

## Báo cáo & cảnh báo qua Telegram

Cùng bot Telegram với sao lưu. Tin gửi vào cuộc trò chuyện nhận sao lưu, hoặc một **nhóm riêng** (Cài đặt › Báo cáo &
cảnh báo › Chọn nơi khác) để người quản lý đọc báo cáo mà không nhận file dữ liệu.

| Tin                   | Khi nào                                              | Nội dung                                                                                                                                      |
| --------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Báo cáo chốt ngày     | Mỗi lần chốt ngày (chốt lại → tin "Chốt lại ngày")   | Doanh thu thuần, số đơn / khách, so với ngày bán trước, lãi gộp tạm tính, tiền theo hình thức, tiền két lệch, giảm giá, huỷ, bán dưới giá vốn |
| Việc cần chú ý (sáng) | Mỗi ngày một lần từ giờ `notify_morning_hour` (8:00) | Doanh số ngày bán trước, ngày chưa chốt, đơn còn mở, hàng sắp hết, nợ kho, món lỗ / vượt mục tiêu, sao lưu lỗi, ngưỡng doanh thu thuế         |
| Cảnh báo ngay         | Lúc xảy ra                                           | Huỷ đơn **đã thanh toán**; giảm giá vượt mức do ADMIN duyệt PIN (ADMIN tự giảm thì không báo); thanh toán **dưới giá vốn**                    |

- Tiền két lệch từ `notify_cash_diff` (mặc định 20.000 đ) được tô đậm + ⚠️.
- Tin được ghi vào hàng đợi **trong cùng transaction** với thao tác gây ra nó: thao tác lỗi / bị huỷ thì không có tin.
  Máy chủ mất mạng → tin chờ, tự gửi lại; quá 1 ngày không gửi được thì bỏ. Telegram từ chối một tin 5 lần → bỏ tin đó,
  các tin sau vẫn gửi. Cài đặt hiện số tin đang chờ và lỗi gần nhất.
- Mỗi loại tin bật / tắt riêng. "Gửi thử tin Việc cần chú ý" gửi ngay (không chờ giờ).
