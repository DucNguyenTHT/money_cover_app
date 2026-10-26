# Gọi món bằng mã QR tại bàn

Mỗi bàn dán một mã QR. Khách quét bằng điện thoại (không cần cài app, không đăng nhập):

- Xem thực đơn với **giá tại quán**, chọn món (size, topping, ghi chú), gửi **gọi món**.
- Bấm **Gọi nhân viên** hoặc **Xin thanh toán**.
- Thấy quán đã nhận hay từ chối (kèm lý do) ngay trên trang.

Máy bán hàng **kêu “ting ting”**, hiện thông báo, bàn có nhãn đỏ (_Gọi món_ / _Gọi nhân viên_ / _Xin thanh toán_) và
nút **Yêu cầu (n)** trên Phòng bàn. Nhân viên bấm **Nhận vào đơn** thì món mới vào đơn đang mở của bàn (chưa có đơn thì
mở đơn mới), **chưa gửi bếp** — xem lại rồi bấm _Gửi bếp_ như thường. Không bấm nhận thì không có gì vào đơn: khách
nghịch hay quét nhầm bàn cũng không làm sai số liệu.

## Mạng: điện thoại khách phải mở được trang gọi món

Trang gọi món chạy ngay trên máy chủ của quán, cổng **8081**, dạng `http://` (điện thoại khách không tin chứng chỉ
riêng của quán, nên không dùng `https://` như máy tính bảng). Trên cổng này **chỉ** có trang gọi món và các API công
khai của nó — màn bán hàng, quản trị không mở được từ đây.

- Khách vào **Wi-Fi của quán** và Wi-Fi đó cùng mạng với máy chủ → dùng `http://<IP máy chủ>:8081`
  (vd `http://192.168.1.10:8081`). Nên đặt IP tĩnh cho máy chủ (xem `setup-store.md`).
- Router có **Wi-Fi khách tách riêng** (không thấy máy trong mạng nội bộ): cho mạng khách truy cập IP máy chủ cổng 8081,
  hoặc để khách dùng Wi-Fi chung.
- Không mở cổng này ra Internet nếu không cần (khách 4G sẽ không gọi được món — vẫn gọi nhân viên như thường).

## Cài đặt

1. Máy chủ chạy bản mới (`docker compose -f docker-compose.prod.yml up -d --build`): Caddy mở thêm cổng **8081**.
2. ADMIN → **Hệ thống → Cài đặt → Gọi món bằng mã QR tại bàn** → bật; ô _Địa chỉ trang gọi món_ để trống (= tự lấy IP
   của máy đang in, cổng 8081) hoặc nhập `http://192.168.1.10:8081`. **Lưu cài đặt.**
3. **Hệ thống → Bàn & khu vực → Mã QR gọi món** → **In tất cả** (giấy A4, 2 mã một hàng; cắt ra, ép plastic, dán bàn).
4. Thử: điện thoại vào Wi-Fi quán, quét mã một bàn, gửi một món → máy bán hàng kêu → **Nhận vào đơn**.

Đổi địa chỉ (đổi IP máy chủ) thì in lại toàn bộ mã. Một mã bị chụp lại / dán nhầm bàn: bấm **Đổi mã** ở bàn đó (mã cũ
hết dùng ngay) rồi in lại mã bàn đó.

## Giới hạn & an toàn

- Không đăng nhập: ai có mã của bàn thì gửi được yêu cầu cho **đúng bàn đó**. Mã là chuỗi ngẫu nhiên, không đoán được;
  tắt chức năng ở Cài đặt thì mọi mã ngừng hoạt động.
- Mỗi điện thoại: tối đa 8 lần gửi / phút, 3 yêu cầu đang chờ; mỗi bàn tối đa 5 yêu cầu đang chờ. Gọi nhân viên /
  xin thanh toán bấm nhiều lần vẫn là một yêu cầu.
- Mỗi lần gọi tối đa 30 dòng, mỗi món 1–20 phần. Món hết, ngừng bán, chưa có giá không hiện; giá và tuỳ chọn được kiểm
  lại khi gửi và khi nhân viên nhận.
- Trang khách **không có** giá vốn, lãi hay thông tin đơn khác. Khuyến mãi (giờ vàng, combo) tính khi món vào đơn.
- Yêu cầu chờ quá 3 giờ không hiện nữa (khách đã về hoặc đã gọi trực tiếp).
