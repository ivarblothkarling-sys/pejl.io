import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pejl — Din AI-ekonomiassistent som ser 14 dagar framåt" },
      {
        name: "description",
        content:
          "Pejl kopplas till Fortnox och ger dig en automatisk prognos över kassaflödet — så du alltid vet vad som händer, innan det händer.",
      },
      { property: "og:title", content: "Pejl — Din AI-ekonomiassistent" },
      {
        property: "og:description",
        content: "Se 14 dagar framåt i kassaflödet. Få varningar innan pengarna tar slut.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500;600&display=swap",
      },
    ],
  }),
  component: Landing,
});

const CSS = `
.pejl-landing *{margin:0;padding:0;box-sizing:border-box}
.pejl-landing{
  --black:#080808;--surface:#0F0F0F;--surface-2:#171717;--surface-3:#1F1F1F;
  --border:rgba(255,255,255,0.06);
  --amber:#F5A623;--amber-dim:rgba(245,166,35,0.12);--amber-glow:rgba(245,166,35,0.25);
  --green:#00FF88;--green-dim:rgba(0,255,136,0.08);
  --coral:#E06B50;--coral-dim:rgba(224,107,80,0.08);
  --white:#FFFFFF;--grey:#8A8A8A;--grey-2:#5A5A5A;
  background:var(--black);color:var(--white);
  font-family:'Plus Jakarta Sans',sans-serif;-webkit-font-smoothing:antialiased;
  overflow-x:hidden;min-height:100vh;
}
.pejl-landing a{color:inherit}
.pejl-landing button{font-family:inherit}

.pejl-landing .nav{
  position:fixed;top:0;left:0;right:0;z-index:100;
  display:flex;align-items:center;justify-content:space-between;
  padding:20px 48px;background:rgba(8,8,8,0);backdrop-filter:blur(0px);
  border-bottom:1px solid transparent;transition:all .4s ease;
}
.pejl-landing .nav.scrolled{
  background:rgba(8,8,8,0.9);backdrop-filter:blur(20px);
  border-bottom:1px solid var(--border);
}
.pejl-landing .nav-logo{
  display:flex;align-items:center;gap:10px;
  font-family:'Syne',sans-serif;font-weight:800;font-size:22px;
  color:var(--white);text-decoration:none;letter-spacing:-.02em;cursor:pointer;
}
.pejl-landing .nav-logo-mark{
  width:34px;height:34px;border-radius:8px;
  background:linear-gradient(135deg,var(--amber),#FF8C00);
  display:flex;align-items:center;justify-content:center;
}
.pejl-landing .nav-links{display:flex;align-items:center;gap:36px;list-style:none}
.pejl-landing .nav-links a{color:var(--grey);text-decoration:none;font-size:14px;font-weight:500;transition:color .2s;cursor:pointer}
.pejl-landing .nav-links a:hover{color:var(--white)}
.pejl-landing .nav-cta{
  background:var(--amber);color:var(--black)!important;
  padding:10px 24px;border-radius:6px;font-weight:600!important;
  font-size:14px!important;transition:all .2s!important;
}
.pejl-landing .nav-cta:hover{box-shadow:0 0 30px var(--amber-glow);transform:translateY(-1px)}

.pejl-landing .hero{
  min-height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:center;
  text-align:center;padding:120px 24px 80px;position:relative;overflow:hidden;
}
.pejl-landing .hero::before{
  content:'';position:absolute;top:-200px;left:50%;transform:translateX(-50%);
  width:800px;height:800px;
  background:radial-gradient(ellipse,rgba(245,166,35,0.08) 0%,transparent 70%);
  pointer-events:none;
}
.pejl-landing .hero::after{
  content:'';position:absolute;bottom:-200px;left:20%;
  width:600px;height:600px;
  background:radial-gradient(ellipse,rgba(0,255,136,0.05) 0%,transparent 70%);
  pointer-events:none;
}
.pejl-landing .hero-ticker{
  display:inline-flex;align-items:center;gap:8px;
  background:var(--amber-dim);border:1px solid rgba(245,166,35,0.2);
  border-radius:99px;padding:8px 18px;margin-bottom:40px;
  font-family:'JetBrains Mono',monospace;font-size:12px;
  color:var(--amber);letter-spacing:.08em;
}
.pejl-landing .ticker-dot{width:7px;height:7px;border-radius:50%;background:var(--amber);animation:pejl-pulse 2s ease-in-out infinite}
@keyframes pejl-pulse{0%,100%{box-shadow:0 0 0 0 rgba(245,166,35,.6)}50%{box-shadow:0 0 0 6px rgba(245,166,35,0)}}

.pejl-landing .hero-headline{
  font-family:'Syne',sans-serif;font-weight:800;
  font-size:clamp(32px,5.5vw,70px);line-height:1.08;letter-spacing:-.03em;
  max-width:880px;margin-bottom:28px;
}
.pejl-landing .hero-headline .hi{color:var(--white)}
.pejl-landing .hero-headline .acc{color:var(--amber);position:relative}
.pejl-landing .hero-headline .acc::after{
  content:'';position:absolute;bottom:-4px;left:0;right:0;height:2px;
  background:linear-gradient(90deg,var(--amber),transparent);
}
.pejl-landing .hero-sub{font-size:18px;color:var(--grey);max-width:520px;line-height:1.7;margin-bottom:48px}
.pejl-landing .hero-actions{display:flex;gap:16px;align-items:center;flex-wrap:wrap;justify-content:center}

.pejl-landing .btn-primary{
  background:var(--amber);color:var(--black);
  padding:16px 36px;border-radius:8px;font-size:15px;font-weight:700;
  text-decoration:none;display:inline-flex;align-items:center;gap:8px;cursor:pointer;border:none;
  transition:all .25s;box-shadow:0 0 24px var(--amber-glow);
  font-family:'Syne',sans-serif;letter-spacing:-.01em;
}
.pejl-landing .btn-primary:hover{transform:translateY(-2px);box-shadow:0 0 40px rgba(245,166,35,.4)}
.pejl-landing .btn-primary svg{transition:transform .2s}
.pejl-landing .btn-primary:hover svg{transform:translateX(3px)}
.pejl-landing .btn-ghost{
  color:var(--white);font-size:15px;font-weight:500;
  text-decoration:none;display:inline-flex;align-items:center;gap:8px;
  padding:16px 24px;border-radius:8px;border:1px solid var(--border);
  transition:all .2s;background:transparent;cursor:pointer;
}
.pejl-landing .btn-ghost:hover{border-color:rgba(255,255,255,.2);background:var(--surface)}

.pejl-landing .stats-row{
  display:flex;justify-content:center;gap:0;
  border-top:1px solid var(--border);border-bottom:1px solid var(--border);margin-top:80px;
}
.pejl-landing .stat-item{padding:32px 48px;border-right:1px solid var(--border);text-align:center;flex:1;max-width:280px}
.pejl-landing .stat-item:last-child{border-right:none}
.pejl-landing .stat-num{
  font-family:'JetBrains Mono',monospace;font-size:36px;font-weight:600;
  color:var(--amber);line-height:1;margin-bottom:8px;display:block;
}
.pejl-landing .stat-label{font-size:13px;color:var(--grey);line-height:1.4}

.pejl-landing .section{padding:120px 24px;max-width:1100px;margin:0 auto}
.pejl-landing .eyebrow{
  font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.2em;
  text-transform:uppercase;color:var(--amber);margin-bottom:20px;
  display:flex;align-items:center;gap:12px;
}
.pejl-landing .eyebrow::before{content:'';width:24px;height:1px;background:var(--amber)}
.pejl-landing .section-title{
  font-family:'Syne',sans-serif;font-size:clamp(28px,4.5vw,52px);
  font-weight:800;line-height:1.1;letter-spacing:-.03em;
  max-width:640px;margin-bottom:20px;
}
.pejl-landing .section-body{font-size:18px;color:var(--grey);max-width:520px;line-height:1.7;margin-bottom:56px}

.pejl-landing .scenario-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border);border-radius:16px;overflow:hidden}
.pejl-landing .scenario-card{background:var(--surface);padding:40px 32px;position:relative;overflow:hidden}
.pejl-landing .scenario-card::before{
  content:'';position:absolute;inset:0;
  background:linear-gradient(135deg,var(--amber-dim),transparent);
  opacity:0;transition:opacity .3s;
}
.pejl-landing .scenario-card:hover::before{opacity:1}
.pejl-landing .sc-icon{
  width:48px;height:48px;border-radius:12px;
  background:var(--coral-dim);border:1px solid rgba(224,107,80,.15);
  display:flex;align-items:center;justify-content:center;font-size:22px;margin-bottom:24px;
}
.pejl-landing .sc-title{font-family:'Syne',sans-serif;font-size:18px;font-weight:700;margin-bottom:10px;line-height:1.3}
.pejl-landing .sc-body{font-size:14px;color:var(--grey);line-height:1.6}
.pejl-landing .sc-amount{
  display:inline-block;margin-top:16px;
  font-family:'JetBrains Mono',monospace;font-size:13px;
  color:var(--coral);background:var(--coral-dim);
  padding:4px 12px;border-radius:99px;border:1px solid rgba(224,107,80,.2);
}

.pejl-landing .solution-section{padding:120px 0;overflow:hidden;position:relative}
.pejl-landing .solution-section::before{
  content:'';position:absolute;inset:0;
  background:linear-gradient(180deg,var(--black) 0%,var(--surface) 50%,var(--black) 100%);
}
.pejl-landing .solution-inner{max-width:1100px;margin:0 auto;padding:0 24px;position:relative}
.pejl-landing .steps-container{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border);border-radius:16px;overflow:hidden;margin-top:64px}
.pejl-landing .step-card{background:var(--surface);padding:40px 28px;position:relative;overflow:hidden}
.pejl-landing .step-card::after{
  content:'';position:absolute;top:0;left:0;right:0;height:2px;
  background:linear-gradient(90deg,var(--amber),transparent);
  transform:scaleX(0);transform-origin:left;transition:transform .4s ease;
}
.pejl-landing .step-card:hover::after{transform:scaleX(1)}
.pejl-landing .step-num{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--amber);letter-spacing:.16em;margin-bottom:24px;display:block}
.pejl-landing .step-title{font-family:'Syne',sans-serif;font-size:18px;font-weight:700;margin-bottom:12px;line-height:1.3}
.pejl-landing .step-body{font-size:13px;color:var(--grey);line-height:1.6}
.pejl-landing .step-visual{
  margin-top:24px;padding:12px;background:var(--surface-2);
  border-radius:8px;border:1px solid var(--border);
  font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--green);white-space:pre-line;
}

.pejl-landing .dashboard-section{padding:80px 24px}
.pejl-landing .dashboard-inner{max-width:1100px;margin:0 auto}
.pejl-landing .dashboard-frame{
  background:var(--surface);border:1px solid var(--border);
  border-radius:20px;overflow:hidden;
  box-shadow:0 60px 120px -40px rgba(0,0,0,.8),0 0 0 1px rgba(255,255,255,.04);
  margin-top:56px;
}
.pejl-landing .db-bar{display:flex;align-items:center;gap:8px;padding:14px 18px;border-bottom:1px solid var(--border);background:var(--surface-2)}
.pejl-landing .db-dot{width:10px;height:10px;border-radius:50%}
.pejl-landing .db-dot-r{background:#FF5F57}.pejl-landing .db-dot-a{background:#FEBC2E}.pejl-landing .db-dot-g{background:#28C840}
.pejl-landing .db-url{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--grey-2);margin-left:10px}
.pejl-landing .db-body{padding:32px;display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:16px;margin-bottom:24px}
.pejl-landing .db-card{background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:18px}
.pejl-landing .db-card-label{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--grey-2);text-transform:uppercase;letter-spacing:.12em;margin-bottom:8px}
.pejl-landing .db-card-val{font-family:'JetBrains Mono',monospace;font-size:24px;font-weight:600;color:var(--white)}
.pejl-landing .db-card-val.green{color:var(--green);text-shadow:0 0 20px rgba(0,255,136,.3)}
.pejl-landing .db-card-val.amber{color:var(--amber)}
.pejl-landing .db-card-val.red{color:var(--coral);text-shadow:0 0 20px rgba(224,107,80,.3)}
.pejl-landing .db-alert{
  margin:0 32px 24px;
  background:rgba(224,107,80,.08);border:1px solid rgba(224,107,80,.2);
  border-radius:12px;padding:16px 20px;display:flex;align-items:flex-start;gap:14px;
}
.pejl-landing .db-alert-icon{color:var(--coral);font-size:18px;flex-shrink:0;line-height:1;font-weight:700}
.pejl-landing .db-alert-title{font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--coral);margin-bottom:4px}
.pejl-landing .db-alert-body{font-size:13px;color:var(--grey)}
.pejl-landing .db-chart-wrap{margin:0 32px 32px}
.pejl-landing .db-chart-label{font-size:12px;color:var(--grey-2);margin-bottom:10px;font-family:'JetBrains Mono',monospace}
.pejl-landing .db-chart{height:110px;position:relative}
.pejl-landing .db-chart svg{width:100%;height:100%}

.pejl-landing .demo-section{padding:120px 24px;text-align:center;position:relative}
.pejl-landing .demo-section::before{
  content:'';position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
  width:600px;height:600px;
  background:radial-gradient(ellipse,rgba(0,255,136,0.04) 0%,transparent 70%);
  pointer-events:none;
}
.pejl-landing .chat-demo{
  max-width:640px;margin:56px auto 0;
  background:var(--surface);border:1px solid var(--border);
  border-radius:20px;overflow:hidden;
  box-shadow:0 40px 80px -20px rgba(0,0,0,.6);text-align:left;
}
.pejl-landing .chat-header{padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;background:var(--surface-2)}
.pejl-landing .chat-avatar{
  width:32px;height:32px;border-radius:50%;
  background:linear-gradient(135deg,var(--amber),#FF8C00);
  display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#080808;
}
.pejl-landing .chat-name{font-family:'Syne',sans-serif;font-weight:700;font-size:14px}
.pejl-landing .chat-status{font-size:12px;color:var(--green);display:flex;align-items:center;gap:5px;margin-top:2px}
.pejl-landing .chat-status::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--green)}
.pejl-landing .chat-messages{padding:20px;display:flex;flex-direction:column;gap:12px;min-height:280px}
.pejl-landing .msg{padding:12px 16px;border-radius:12px;font-size:14px;line-height:1.6;max-width:80%;animation:pejl-msgIn .3s ease}
@keyframes pejl-msgIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.pejl-landing .msg.user{align-self:flex-end;background:var(--amber);color:var(--black);font-weight:500;border-radius:12px 12px 2px 12px}
.pejl-landing .msg.ai{background:var(--surface-2);border:1px solid var(--border);border-radius:12px 12px 12px 2px;color:var(--white)}
.pejl-landing .msg.ai strong{color:var(--green)}
.pejl-landing .msg.ai .warn{color:var(--coral)}
.pejl-landing .msg-actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.pejl-landing .msg-btn{font-size:12px;font-weight:600;padding:7px 16px;border-radius:99px;border:none;cursor:pointer;font-family:'Plus Jakarta Sans',sans-serif;transition:all .2s}
.pejl-landing .msg-btn.primary{background:var(--amber);color:var(--black)}
.pejl-landing .msg-btn.ghost{background:var(--surface-3);color:var(--white);border:1px solid var(--border)}
.pejl-landing .msg-btn:hover{transform:translateY(-1px)}
.pejl-landing .chat-input{padding:16px 20px;border-top:1px solid var(--border);display:flex;gap:12px;align-items:center;background:var(--surface-2)}
.pejl-landing .chat-input input{
  flex:1;background:var(--surface-3);border:1px solid var(--border);
  border-radius:8px;padding:10px 16px;color:var(--white);font-size:14px;
  font-family:'Plus Jakarta Sans',sans-serif;outline:none;
}
.pejl-landing .chat-send{
  width:36px;height:36px;border-radius:8px;background:var(--amber);
  border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .2s;
}
.pejl-landing .chat-send:hover{box-shadow:0 0 16px var(--amber-glow)}

.pejl-landing .consultant-section{padding:120px 24px;background:linear-gradient(180deg,transparent 0%,rgba(0,255,136,0.02) 50%,transparent 100%)}
.pejl-landing .consultant-inner{max-width:1100px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center}
.pejl-landing .benefit-list{margin-top:48px;display:flex;flex-direction:column;gap:24px}
.pejl-landing .benefit{display:flex;gap:16px;align-items:flex-start}
.pejl-landing .benefit-icon{
  width:36px;height:36px;border-radius:8px;flex-shrink:0;margin-top:2px;
  background:var(--green-dim);border:1px solid rgba(0,255,136,.15);
  display:flex;align-items:center;justify-content:center;color:var(--green);font-size:16px;font-weight:700;
}
.pejl-landing .benefit h4{font-family:'Syne',sans-serif;font-weight:700;font-size:16px;margin-bottom:4px}
.pejl-landing .benefit p{font-size:14px;color:var(--grey);line-height:1.5}
.pejl-landing .quote-card{background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:40px;position:relative;overflow:hidden}
.pejl-landing .quote-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--green),transparent)}
.pejl-landing .quote-mark{font-family:'Syne',sans-serif;font-size:80px;font-weight:800;color:rgba(0,255,136,.1);line-height:1;margin-bottom:-20px}
.pejl-landing .quote-text{font-family:'Syne',sans-serif;font-size:19px;font-weight:600;line-height:1.5;color:var(--white);margin-bottom:28px;font-style:italic}
.pejl-landing .quote-author{display:flex;align-items:center;gap:14px}
.pejl-landing .quote-avatar{
  width:44px;height:44px;border-radius:50%;
  background:linear-gradient(135deg,var(--green),#00CC6A);
  display:flex;align-items:center;justify-content:center;
  font-family:'Syne',sans-serif;font-weight:700;color:var(--black);font-size:16px;
}
.pejl-landing .quote-name{font-weight:600;font-size:14px}
.pejl-landing .quote-role{font-size:13px;color:var(--grey)}

.pejl-landing .pricing-section{padding:120px 24px}
.pejl-landing .pricing-inner{max-width:900px;margin:0 auto;text-align:center}
.pejl-landing .pricing-grid{display:grid;grid-template-columns:1fr 1fr;gap:2px;background:var(--border);border-radius:20px;overflow:hidden;margin-top:56px;text-align:left}
.pejl-landing .pricing-card{background:var(--surface);padding:48px}
.pejl-landing .pricing-card.featured{background:var(--surface-2);position:relative}
.pejl-landing .pricing-card.featured::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--amber),rgba(245,166,35,.3),transparent)}
.pejl-landing .price-tag{font-family:'JetBrains Mono',monospace;font-size:42px;font-weight:600;color:var(--white);line-height:1;margin-bottom:4px}
.pejl-landing .price-tag .currency{font-size:20px;color:var(--grey);vertical-align:super;margin-right:2px}
.pejl-landing .price-tag .period{font-size:16px;color:var(--grey);font-weight:400}
.pejl-landing .price-name{font-family:'Syne',sans-serif;font-size:20px;font-weight:700;margin-bottom:8px}
.pejl-landing .price-desc{font-size:14px;color:var(--grey);margin-bottom:32px;line-height:1.5}
.pejl-landing .price-features{list-style:none;display:flex;flex-direction:column;gap:12px;margin-bottom:36px}
.pejl-landing .price-features li{display:flex;align-items:center;gap:12px;font-size:14px}
.pejl-landing .price-features li::before{content:'✓';color:var(--green);font-weight:700;flex-shrink:0}
.pejl-landing .price-btn{
  display:block;text-align:center;padding:14px;border-radius:8px;
  font-weight:700;font-size:14px;text-decoration:none;
  transition:all .2s;font-family:'Syne',sans-serif;cursor:pointer;border:none;
}
.pejl-landing .price-btn.amber{background:var(--amber);color:var(--black);box-shadow:0 0 20px var(--amber-glow)}
.pejl-landing .price-btn.amber:hover{box-shadow:0 0 30px rgba(245,166,35,.5);transform:translateY(-1px)}
.pejl-landing .price-btn.outline{border:1px solid var(--border);color:var(--white);background:transparent}
.pejl-landing .price-btn.outline:hover{border-color:rgba(255,255,255,.2);background:var(--surface-3)}
.pejl-landing .price-badge{display:inline-block;margin-bottom:16px;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.1em;background:var(--amber-dim);border:1px solid rgba(245,166,35,.2);color:var(--amber);padding:4px 12px;border-radius:99px}

.pejl-landing .cta-section{padding:120px 24px;text-align:center;position:relative;overflow:hidden}
.pejl-landing .cta-section::before{content:'';position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:800px;height:800px;background:radial-gradient(ellipse,rgba(245,166,35,0.06) 0%,transparent 70%);pointer-events:none}
.pejl-landing .cta-title{font-family:'Syne',sans-serif;font-size:clamp(36px,6vw,72px);font-weight:800;line-height:1.05;letter-spacing:-.03em;max-width:800px;margin:0 auto 28px}
.pejl-landing .cta-sub{font-size:18px;color:var(--grey);margin-bottom:48px;max-width:480px;margin-left:auto;margin-right:auto}
.pejl-landing .waitlist-form{display:flex;gap:12px;max-width:480px;margin:0 auto;flex-wrap:wrap;justify-content:center}
.pejl-landing .waitlist-input{flex:1;min-width:240px;padding:16px 20px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--white);font-size:15px;outline:none;font-family:'Plus Jakarta Sans',sans-serif;transition:border-color .2s}
.pejl-landing .waitlist-input::placeholder{color:var(--grey-2)}
.pejl-landing .waitlist-input:focus{border-color:var(--amber)}
.pejl-landing .waitlist-btn{padding:16px 32px;border-radius:8px;border:none;cursor:pointer;background:var(--amber);color:var(--black);font-size:15px;font-weight:700;transition:all .2s;font-family:'Syne',sans-serif;box-shadow:0 0 24px var(--amber-glow)}
.pejl-landing .waitlist-btn:hover{transform:translateY(-2px);box-shadow:0 0 36px rgba(245,166,35,.4)}
.pejl-landing .cta-note{font-size:12px;color:var(--grey-2);margin-top:16px;font-family:'JetBrains Mono',monospace}

.pejl-landing footer{padding:48px;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:20px}
.pejl-landing .footer-logo{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:var(--white);text-decoration:none;letter-spacing:-.02em;cursor:pointer}
.pejl-landing .footer-links{display:flex;gap:32px}
.pejl-landing .footer-links a{color:var(--grey-2);font-size:13px;text-decoration:none;transition:color .2s;cursor:pointer}
.pejl-landing .footer-links a:hover{color:var(--white)}
.pejl-landing .footer-copy{font-size:12px;color:var(--grey-2);font-family:'JetBrains Mono',monospace}

.pejl-landing .reveal{opacity:0;transform:translateY(24px);transition:opacity .6s ease,transform .6s ease}
.pejl-landing .reveal.visible{opacity:1;transform:translateY(0)}
.pejl-landing .reveal-delay-1{transition-delay:.1s}
.pejl-landing .reveal-delay-2{transition-delay:.2s}
.pejl-landing .reveal-delay-3{transition-delay:.3s}

@media(max-width:900px){
  .pejl-landing .nav{padding:16px 20px}
  .pejl-landing .nav-links{display:none}
  .pejl-landing .stats-row{flex-wrap:wrap}
  .pejl-landing .stat-item{min-width:50%;border-right:none;border-bottom:1px solid var(--border)}
  .pejl-landing .scenario-grid{grid-template-columns:1fr}
  .pejl-landing .steps-container{grid-template-columns:1fr 1fr}
  .pejl-landing .consultant-inner{grid-template-columns:1fr;gap:48px}
  .pejl-landing .pricing-grid{grid-template-columns:1fr}
  .pejl-landing .db-body{grid-template-columns:1fr 1fr}
  .pejl-landing footer{flex-direction:column;align-items:flex-start;padding:32px 20px}
}
@media(max-width:600px){
  .pejl-landing .steps-container{grid-template-columns:1fr}
  .pejl-landing .db-body{grid-template-columns:1fr}
}
`;

const CHAT_RESPONSES: Record<string, string> = {
  "när förfaller min moms":
    'Din nästa momsdeklaration förfaller <strong>26 juni 2026</strong>. Beräknat belopp: <span class="warn">9 800 kr</span>. Med nuvarande prognos klarar du den — men precis. Vill du att jag sätter en påminnelse?',
  "vilka fakturor är obetalda":
    'Du har <strong>4 obetalda kundfakturor</strong>:<br><br>• Kund AB #1043 — 14 200 kr (12 dagar sen)<br>• Nordic Design — 8 900 kr (förfaller 17 jun)<br>• Mediabol. Norr — 22 000 kr (förfaller 25 jun)<br>• Hantverkarna — 7 600 kr (förfaller 28 jun)',
  "hur går det ekonomiskt":
    'Det ser <strong style="color:var(--amber)">ansträngt ut de närmaste 2 veckorna</strong>, men stabilt på sikt.<br><br>Kassan idag: 48 500 kr. Lägsta punkt: 12 300 kr (19 jun). Om Kund AB betalar i tid landar ni på +26 700 kr den 28:e.',
  default:
    'Bra fråga. Baserat på din bokföringsdata i Fortnox: <strong>kassan ser tight ut de närmaste 10 dagarna</strong>. Vill du att jag analyserar ett specifikt scenario?',
};

function Landing() {
  const navigate = useNavigate();
  const goDashboard = () => navigate({ to: "/dashboard" });

  useEffect(() => {
    // Stat counters
    const counters: Array<{ el: HTMLElement; target: number; suffix: string }> = [];
    document.querySelectorAll<HTMLElement>(".pejl-landing [data-target]").forEach((el) => {
      counters.push({
        el,
        target: parseInt(el.dataset.target || "0", 10),
        suffix: el.dataset.suffix || "",
      });
    });

    const animateCounter = (item: (typeof counters)[number]) => {
      const duration = 2000;
      const step = Math.max(10, duration / item.target);
      let current = 0;
      const timer = window.setInterval(() => {
        current = Math.min(current + Math.ceil(item.target / 80), item.target);
        item.el.textContent = current.toLocaleString("sv-SE") + item.suffix;
        if (current >= item.target) window.clearInterval(timer);
      }, step);
    };

    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("visible");
            revealObserver.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 },
    );
    document.querySelectorAll(".pejl-landing .reveal").forEach((el) => revealObserver.observe(el));

    const statsRow = document.querySelector(".pejl-landing .stats-row");
    let statsObserver: IntersectionObserver | null = null;
    if (statsRow) {
      statsObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              counters.forEach(animateCounter);
              statsObserver?.unobserve(e.target);
            }
          });
        },
        { threshold: 0.3 },
      );
      statsObserver.observe(statsRow);
    }

    const onScroll = () => {
      const nav = document.getElementById("pejl-nav");
      if (nav) nav.classList.toggle("scrolled", window.scrollY > 40);
    };
    window.addEventListener("scroll", onScroll);

    return () => {
      revealObserver.disconnect();
      statsObserver?.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const sendDemoMsg = () => {
    const input = document.getElementById("pejl-demo-input") as HTMLInputElement | null;
    const messages = document.getElementById("pejl-chat-messages");
    if (!input || !messages) return;
    const val = input.value.trim();
    if (!val) return;
    const userMsg = document.createElement("div");
    userMsg.className = "msg user";
    userMsg.textContent = val;
    messages.appendChild(userMsg);
    input.value = "";
    setTimeout(() => {
      const aiMsg = document.createElement("div");
      aiMsg.className = "msg ai";
      const lower = val.toLowerCase();
      let response = CHAT_RESPONSES.default;
      for (const [key, val2] of Object.entries(CHAT_RESPONSES)) {
        if (key !== "default" && lower.includes(key.split(" ")[0])) {
          response = val2;
          break;
        }
      }
      aiMsg.innerHTML = response;
      messages.appendChild(aiMsg);
      messages.scrollTop = messages.scrollHeight;
    }, 800);
    messages.scrollTop = messages.scrollHeight;
  };

  const triggerDemo = () => {
    const messages = document.getElementById("pejl-chat-messages");
    if (!messages) return;
    const toast = document.createElement("div");
    toast.className = "msg ai";
    toast.innerHTML =
      '<strong style="color:var(--green)">✓ Påminnelse skickad till Kund AB</strong><br><br>Ny prognos den 28 juni: <strong style="color:var(--green)">+26 700 kr</strong>. Du har nu god marginal för löner och moms. Prognosen är uppdaterad i realtid.';
    messages.appendChild(toast);
    messages.scrollTop = messages.scrollHeight;
  };

  const joinWaitlist = () => {
    const input = document.getElementById("pejl-email-input") as HTMLInputElement | null;
    const btn = document.querySelector<HTMLButtonElement>(".pejl-landing .waitlist-btn");
    if (!input || !btn) return;
    if (input.value.includes("@")) {
      btn.textContent = "✓ Du är med!";
      btn.style.background = "var(--green)";
      btn.style.color = "var(--black)";
      btn.style.boxShadow = "0 0 24px rgba(0,255,136,.3)";
      input.value = "";
      input.placeholder = "Tack — vi hör av oss snart.";
      setTimeout(() => {
        btn.textContent = "Anmäl mig →";
        btn.style.background = "";
        btn.style.color = "";
        btn.style.boxShadow = "";
        input.placeholder = "din@email.se";
      }, 4000);
    } else {
      input.style.borderColor = "var(--coral)";
      input.placeholder = "Ange en giltig e-post";
      setTimeout(() => {
        input.style.borderColor = "";
        input.placeholder = "din@email.se";
      }, 2500);
    }
  };

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  const ArrowIcon = () => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );

  return (
    <div className="pejl-landing">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <nav className="nav" id="pejl-nav">
        <a className="nav-logo" onClick={() => scrollTo("pejl-top")}>
          <div className="nav-logo-mark">
            <svg
              viewBox="0 0 20 20"
              width="16"
              height="16"
              fill="none"
              stroke="#080808"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <circle cx="10" cy="10" r="8.5" />
              <line x1="10" y1="10" x2="10" y2="4.5" />
              <line x1="10" y1="10" x2="13.5" y2="12" />
            </svg>
          </div>
          Pejl
        </a>
        <ul className="nav-links">
          <li>
            <a onClick={() => scrollTo("how")}>Hur det fungerar</a>
          </li>
          <li>
            <a onClick={() => scrollTo("konsulter")}>För konsulter</a>
          </li>
          <li>
            <a onClick={() => scrollTo("pris")}>Pris</a>
          </li>
          <li>
            <a className="nav-cta" onClick={goDashboard}>
              Prova gratis →
            </a>
          </li>
        </ul>
      </nav>

      <section className="hero" id="pejl-top">
        <div className="hero-ticker">
          <span className="ticker-dot" />
          FORTNOX-INTEGRATION · LANSERAS SNART
        </div>

        <h1 className="hero-headline">
          <span className="hi">Din AI-ekonomiassistent</span>
          <br />
          <span className="hi">som ser </span>
          <span className="acc">14 dagar framåt</span>
        </h1>

        <p className="hero-sub">
          Pejl kopplas till Fortnox och ger dig en automatisk prognos över kassaflödet — så du
          alltid vet vad som händer, innan det händer.
        </p>

        <div className="hero-actions">
          <button className="btn-primary" onClick={goDashboard}>
            Prova gratis i 30 dagar
            <ArrowIcon />
          </button>
          <button className="btn-ghost" onClick={() => scrollTo("how")}>
            Se hur det fungerar
          </button>
        </div>

        <div className="stats-row">
          <div className="stat-item">
            <span className="stat-num" data-target="100" data-suffix="%">
              0%
            </span>
            <div className="stat-label">
              av intervjuade företagare har blivit överraskade av likviditetsproblem
            </div>
          </div>
          <div className="stat-item">
            <span className="stat-num" data-target="500" data-suffix="K+">
              0
            </span>
            <div className="stat-label">Fortnox-kunder i Sverige – vår primära marknad</div>
          </div>
          <div className="stat-item">
            <span className="stat-num" data-target="14" data-suffix=" dagar">
              0
            </span>
            <div className="stat-label">
              i förväg ser Pejl ett likviditetsproblem du annars inte visste om
            </div>
          </div>
          <div className="stat-item">
            <span className="stat-num" data-target="199" data-suffix=" kr">
              0
            </span>
            <div className="stat-label">
              per månad. Billigare än en enda timme av konsulttid i panik
            </div>
          </div>
        </div>
      </section>

      <div className="section reveal">
        <div className="eyebrow">Problemet</div>
        <h2 className="section-title">
          Bokföringen visar vad som hänt. Pejl visar vad som händer härnäst.
        </h2>
        <p className="section-body">
          Bokföringsprogram visar vad som hänt. Inte vad som är på väg att hända. Ingen produkt du
          använder idag ger dig ett kassaflöde framåt. Det är vad Pejl löser.
        </p>

        <div className="scenario-grid">
          <div className="scenario-card reveal">
            <div className="sc-icon" />
            <h3 className="sc-title">Saldot ger falsk trygghet</h3>
            <p className="sc-body">
              48 500 kr på kontot ser bra ut. Tills löner, hyra och moms dras samma vecka – och det
              plötsligt är 3 200 kr kvar, och mer pengar är på väg ut.
            </p>
            <span className="sc-amount">Kan hända snabbare än du tror</span>
          </div>
          <div className="scenario-card reveal reveal-delay-1">
            <div className="sc-icon" />
            <h3 className="sc-title">Momsen glöms alltid</h3>
            <p className="sc-body">
              Skatteinbetalningar syns inte i saldot. De syns inte i bokföringen förrän de slagit
              igenom. Pejl visar dem 14 dagar i förväg — så du kan planera i lugn och ro.
            </p>
            <span className="sc-amount">Vanligaste orsaken till likviditetsstress</span>
          </div>
          <div className="scenario-card reveal reveal-delay-2">
            <div className="sc-icon" />
            <h3 className="sc-title">Akutsamtalet till konsulten</h3>
            <p className="sc-body">
              En halvdag för din konsult. En halvdag för dig. Ett problem som Pejl hade flaggat för
              12 dagar sedan – om ni hade haft det.
            </p>
            <span className="sc-amount">Tid som kunde lagts på rätt saker</span>
          </div>
        </div>
      </div>

      <div className="solution-section" id="how">
        <div className="solution-inner">
          <div className="eyebrow reveal">Hur Pejl fungerar</div>
          <h2 className="section-title reveal">Koppla Fortnox. Pejl tar det därifrån.</h2>
          <p className="section-body reveal">
            Inga manuella inmatningar. Ingen komplex setup. 60 sekunder från konto till koll.
          </p>

          <div className="steps-container">
            <div className="step-card reveal">
              <span className="step-num">01 / KOPPLA</span>
              <h3 className="step-title">OAuth med Fortnox</h3>
              <p className="step-body">
                En knapp. Pejl kopplas säkert till ditt Fortnox-konto via OAuth. Vi läser dina data
                – vi skriver aldrig något.
              </p>
              <div className="step-visual">{"✓ Fortnox ansluten\n✓ Data synkad\n✓ Prognos klar"}</div>
            </div>
            <div className="step-card reveal reveal-delay-1">
              <span className="step-num">02 / ANALYSERA</span>
              <h3 className="step-title">AI räknar framåt</h3>
              <p className="step-body">
                Pejl analyserar fakturor, löner, hyra och skattebetalningar och beräknar ett
                kassaflöde 14 dagar framåt. Automatiskt, varje dag.
              </p>
              <div className="step-visual">
                {"→ Prognos uppdateras\n→ Mönster identifieras\n→ Risker beräknas"}
              </div>
            </div>
            <div className="step-card reveal reveal-delay-2">
              <span className="step-num">03 / VARNA</span>
              <h3 className="step-title">Notis i rätt tid</h3>
              <p className="step-body">
                När prognosen visar en risk varnar Pejl dig – med exakt datum, exakt belopp och
                exakt orsak. Inte när det är för sent.
              </p>
              <div className="step-visual" style={{ color: "var(--coral)" }}>
                {"19 jun: 12 300 kr\nLöner + moms krockar\nAgera idag"}
              </div>
            </div>
            <div className="step-card reveal reveal-delay-3">
              <span className="step-num">04 / AGERA</span>
              <h3 className="step-title">Konkret åtgärd</h3>
              <p className="step-body">
                Pejl föreslår vad du kan göra: skicka påminnelse, skjut en betalning, fakturera nu.
                Du bestämmer alltid. Prognosen uppdateras live.
              </p>
              <div className="step-visual">
                {"✓ Påminnelse skickad\n✓ Prognos förbättrad\n✓ +18 400 kr i kassan"}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="dashboard-section">
        <div className="dashboard-inner">
          <div className="eyebrow reveal" style={{ justifyContent: "center" }}>
            Produkten
          </div>
          <h2 className="section-title reveal" style={{ maxWidth: "100%", textAlign: "center" }}>
            Så ser det ut
          </h2>

          <div className="dashboard-frame reveal">
            <div className="db-bar">
              <div className="db-dot db-dot-r" />
              <div className="db-dot db-dot-a" />
              <div className="db-dot db-dot-g" />
              <span className="db-url">pejl.app · din@foretag.se</span>
            </div>

            <div className="db-body">
              <div className="db-card">
                <div className="db-card-label">Dagens saldo</div>
                <div className="db-card-val">48 500 kr</div>
              </div>
              <div className="db-card">
                <div className="db-card-label">Om 14 dagar</div>
                <div className="db-card-val red">12 300 kr</div>
              </div>
              <div className="db-card">
                <div className="db-card-label">Lägsta punkt</div>
                <div className="db-card-val amber">Fre 19 jun</div>
              </div>
              <div className="db-card">
                <div className="db-card-label">Status</div>
                <div
                  className="db-card-val"
                  style={{ fontSize: 14, paddingTop: 4, color: "var(--amber)" }}
                >
                  Bevaka kassan
                </div>
              </div>
            </div>

            <div className="db-alert">
              <div className="db-alert-icon">!</div>
              <div>
                <div className="db-alert-title">
                  Löner + moms den 19 juni tar saldot till 12 300 kr
                </div>
                <div className="db-alert-body">
                  Kundfaktura #1043 (14 200 kr) är 12 dagar försenad — betalar kunden i tid
                  återställs prognosen till +6 600 kr.
                </div>
              </div>
            </div>

            <div className="db-chart-wrap">
              <div className="db-chart-label">
                Prognos 14 dagar framåt — baserat på kända in- och utbetalningar
              </div>
              <div className="db-chart">
                <svg viewBox="0 0 700 110" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="pejlLineGrad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#00FF88" />
                      <stop offset="60%" stopColor="#F5A623" />
                      <stop offset="100%" stopColor="#FF4057" />
                    </linearGradient>
                    <linearGradient id="pejlFillGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgba(0,255,136,0.15)" />
                      <stop offset="100%" stopColor="rgba(0,255,136,0)" />
                    </linearGradient>
                  </defs>
                  <line
                    x1="0"
                    y1="78"
                    x2="700"
                    y2="78"
                    stroke="rgba(255,255,255,0.06)"
                    strokeWidth="1"
                    strokeDasharray="5 5"
                  />
                  <polygon
                    points="0,22 100,32 200,48 300,65 420,78 520,86 620,90 700,88 700,110 0,110"
                    fill="url(#pejlFillGrad)"
                  />
                  <polyline
                    points="0,22 100,32 200,48 300,65 420,78 520,86 620,90 700,88"
                    fill="none"
                    stroke="url(#pejlLineGrad)"
                    strokeWidth="2.5"
                  />
                  <circle cx="420" cy="78" r="5" fill="#FF4057">
                    <animate attributeName="r" values="4;7;4" dur="2s" repeatCount="indefinite" />
                    <animate
                      attributeName="opacity"
                      values="1;0.6;1"
                      dur="2s"
                      repeatCount="indefinite"
                    />
                  </circle>
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="demo-section" id="demo">
        <div className="eyebrow reveal" style={{ justifyContent: "center" }}>
          Fråga Pejl
        </div>
        <h2 className="section-title reveal" style={{ maxWidth: "100%", textAlign: "center" }}>
          Ställ alla frågor du inte vet var du ska ställa
        </h2>
        <p className="section-body reveal" style={{ margin: "16px auto 0" }}>
          Pejl förstår din ekonomi och svarar baserat på din riktiga bokföringsdata – inte
          generiska råd.
        </p>

        <div className="chat-demo reveal">
          <div className="chat-header">
            <div className="chat-avatar">P</div>
            <div>
              <div className="chat-name">Pejl</div>
              <div className="chat-status">Online och uppdaterad</div>
            </div>
          </div>

          <div className="chat-messages" id="pejl-chat-messages">
            <div className="msg user">Klarar vi lönen den 19:e?</div>
            <div className="msg ai">
              <strong>Det är tajt, men möjligt</strong> om du agerar idag.
              <br />
              <br />
              Löner (18 900 kr) dras den 19:e. Ditt saldo då beräknas vara{" "}
              <span className="warn">12 300 kr</span> — du klarar lönen men med minimal marginal.
              <br />
              <br />
              Problemet: Moms på 9 800 kr förfaller den 24:e. Utan åtgärd är saldot efter moms{" "}
              <span className="warn">2 500 kr</span>.
              <div className="msg-actions">
                <button className="msg-btn primary" onClick={triggerDemo}>
                  Skicka påminnelse till Kund AB
                </button>
                <button className="msg-btn ghost">Visa alternativ</button>
              </div>
            </div>
          </div>

          <div className="chat-input">
            <input
              type="text"
              id="pejl-demo-input"
              placeholder="Fråga om saldo, fakturor, prognos..."
              onKeyDown={(e) => {
                if (e.key === "Enter") sendDemoMsg();
              }}
            />
            <button className="chat-send" onClick={sendDemoMsg}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#080808"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <section className="consultant-section" id="konsulter">
        <div className="consultant-inner">
          <div>
            <div className="eyebrow">För redovisningskonsulter</div>
            <h2 className="section-title">Slipp akutsamtalen. Bli oumbärlig.</h2>
            <p className="section-body">
              Pejl gör inte din roll onödig. Den gör att du kan använda din kompetens på rätt saker.
            </p>
            <div className="benefit-list">
              <div className="benefit reveal">
                <div className="benefit-icon">✓</div>
                <div>
                  <h4>Inga fler akutsamtal</h4>
                  <p>
                    Klienten ser problemet i Pejl 14 dagar innan det uppstår. Du slipper
                    brandkårsutryckningarna.
                  </p>
                </div>
              </div>
              <div className="benefit reveal reveal-delay-1">
                <div className="benefit-icon">✓</div>
                <div>
                  <h4>Konsultvyn</h4>
                  <p>
                    Se alla dina klienters likviditetsstatus i en översikt – gröna, gula, röda.
                    Agera proaktivt.
                  </p>
                </div>
              </div>
              <div className="benefit reveal reveal-delay-2">
                <div className="benefit-icon">✓</div>
                <div>
                  <h4>Intäkt på Pejl</h4>
                  <p>
                    Erbjud Pejl som tilläggstjänst till dina klienter. Ta ut mer än byråpriset – du
                    tjänar marginalen.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="quote-card reveal">
            <div className="quote-mark">"</div>
            <p className="quote-text">
              Det jobbigaste för företagare idag är bristen på framförhållning. De ser bara
              historisk data – det gör det svårt att planera för nästa vecka. Det sparar mig som
              konsult massor av tid eftersom jag slipper ringa akutsamtal när kontot redan är tomt.
            </p>
            <div className="quote-author">
              <div className="quote-avatar">A</div>
              <div>
                <div className="quote-name">Auktoriserad redovisningskonsult</div>
                <div className="quote-role">Fortnox-byrå · Stockholm</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="pricing-section" id="pris">
        <div className="pricing-inner">
          <div className="eyebrow reveal" style={{ justifyContent: "center" }}>
            Pris
          </div>
          <h2 className="section-title reveal" style={{ maxWidth: "100%", textAlign: "center" }}>
            Enkelt. Utan bindning.
          </h2>

          <div className="pricing-grid">
            <div className="pricing-card">
              <p className="price-name">Solo</p>
              <div className="price-tag">
                <span className="currency">kr</span>299<span className="period">/mån</span>
              </div>
              <p className="price-desc">
                Koppla Fortnox, få din prognos. Säg upp när som helst. Ingen bindningstid.
              </p>
              <ul className="price-features">
                <li>14-dagarsprognos kopplad till Fortnox</li>
                <li>Proaktiva likviditetsvarningar</li>
                <li>Skattebevakning (moms, AGI, F-skatt)</li>
                <li>AI-chatt på svenska</li>
                <li>Veckobrev varje måndag</li>
              </ul>
              <button className="price-btn outline" onClick={goDashboard}>
                Prova gratis i 30 dagar
              </button>
            </div>

            <div className="pricing-card featured">
              <span className="price-badge">MEST POPULÄRT</span>
              <p className="price-name">Solo Plus</p>
              <div className="price-tag">
                <span className="currency">kr</span>499<span className="period">/mån</span>
              </div>
              <p className="price-desc">
                Allt i Solo, plus pushnotiser, prioriterad support och full skattebevakning.
              </p>
              <ul className="price-features">
                <li>Allt i Solo</li>
                <li>Pushnotiser och SMS-varningar</li>
                <li>Prioriterad e-postsupport</li>
                <li>Historisk betalningsanalys per kund</li>
                <li>Exportera rapporter</li>
              </ul>
              <button className="price-btn amber" onClick={goDashboard}>
                Prova gratis i 30 dagar →
              </button>
            </div>
          </div>

          <p
            style={{
              textAlign: "center",
              marginTop: 24,
              fontSize: 14,
              color: "var(--grey-2)",
              fontFamily: "'JetBrains Mono',monospace",
            }}
          >
            Redovisningsbyrå? Kontakta oss för byråpris. →{" "}
            <a href="mailto:hej@pejl.se" style={{ color: "var(--amber)" }}>
              hej@pejl.se
            </a>
          </p>
        </div>
      </section>

      <section className="cta-section" id="vantelista">
        <div
          className="eyebrow reveal"
          style={{ justifyContent: "center", color: "var(--amber)" }}
        >
          Kom igång
        </div>
        <h2 className="cta-title reveal">
          Var bland de första
          <br />
          att prova <span style={{ color: "var(--amber)" }}>Pejl</span>
        </h2>
        <p className="cta-sub reveal">
          Testa Pejl gratis i 30 dagar. Ingen bindning, inget kortkrav förrän du är redo.
        </p>
        <div className="hero-actions reveal" style={{ justifyContent: "center" }}>
          <button className="btn-primary" onClick={goDashboard}>
            Prova gratis i 30 dagar
            <ArrowIcon />
          </button>
        </div>
        <p className="cta-note reveal" style={{ marginTop: 24 }}>
          Eller anmäl dig till väntelistan:
        </p>
        <div className="waitlist-form reveal" style={{ marginTop: 16 }}>
          <input
            type="email"
            className="waitlist-input"
            placeholder="din@email.se"
            id="pejl-email-input"
          />
          <button className="waitlist-btn" onClick={joinWaitlist}>
            Anmäl mig →
          </button>
        </div>
        <p className="cta-note reveal">Ingen spam. Inga förköp. Du är bland de första.</p>
      </section>

      <footer>
        <a className="footer-logo" onClick={() => scrollTo("pejl-top")}>
          Pejl
        </a>
        <div className="footer-links">
          <a onClick={goDashboard}>Prova demo</a>
          <a href="/integritetspolicy">Integritetspolicy</a>
          <a href="mailto:hej@pejl.se">hej@pejl.se</a>
        </div>
        <p className="footer-copy">© {new Date().getFullYear()} Pejl AB · Stockholm</p>
      </footer>
    </div>
  );
}
