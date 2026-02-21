CRYPT-TIC website – quick edits

1) Open website/app.js
   - Edit SITE_LINKS (maps, zalo, whatsapp, etc)
   - BOOKING_WEBAPP_URL = your Google Apps Script web-app link
   - VIETQR_IMAGE_URL = direct image link to your VietQR QR code

2) If you want to change the background strength:
   - Open website/styles.css
   - Adjust:
       .bg::before opacity (maze)
       .bg::after  opacity (magnifying glass)

3) Booking buffer/availability rules live in the Apps Script project (Code.gs)
   - This website just links/embeds your booking web app.

Zalo example: https://zalo.me/0393690550


KakaoTalk:
- Edit in website/app.js: SITE_LINKS.kakao
