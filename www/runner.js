// GX Games HTML5 Bootstrapper by NexApp (Iframe Method)
console.log("NexApp: Bootstrapping HTML5 Game inside GX Wrapper...");

// إنشاء عنصر إطار (Iframe) ليملأ الشاشة بالكامل ويستدعي اللعبة الأصلية
const gameIframe = document.createElement('iframe');
gameIframe.src = './index.html';
gameIframe.style.position = 'fixed';
gameIframe.style.top = '0';
gameIframe.style.left = '0';
gameIframe.style.width = '100vw';
gameIframe.style.height = '100vh';
gameIframe.style.border = 'none';

// إدراج الإطار داخل الصفحة ليتم التشغيل فوراً
document.body.appendChild(gameIframe);