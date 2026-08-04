import { Router, type IRouter, type Request, type Response } from "express";
import { db, tokensTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, clusterApiUrl } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { logger } from "../lib/logger";
import { toErrorMessage } from "../utils/error";

const router: IRouter = Router();

// Deliberately independent of SOLANA_RPC_URL — that env var is the live
// mainnet connection solanaPayments.ts uses to verify real USDC subscription
// payments. Reusing it here would mean pointing token-deploy testing at
// devnet could silently break real payment verification, or vice versa.
type SolanaNetwork = "devnet" | "mainnet-beta";

function isSolanaNetwork(v: unknown): v is SolanaNetwork {
  return v === "devnet" || v === "mainnet-beta";
}

function getRpcUrl(network: SolanaNetwork): string {
  if (network === "devnet") {
    return process.env.SOLANA_DEVNET_RPC_URL?.trim() || clusterApiUrl("devnet");
  }
  return process.env.SOLANA_RPC_URL?.trim() || clusterApiUrl("mainnet-beta");
}

function getDeployerKeypair(): Keypair | null {
  const raw = process.env.SOLANA_DEPLOYER_KEY;
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  } catch {
    return null;
  }
}

// ── Seed CASPER + FaceZero on first run ───────────────────────────────────────
async function ensureSeedTokens() {
  const existing = await db.select().from(tokensTable);
  if (existing.length > 0) return;
  await db.insert(tokensTable).values([
    {
      name: "CASPER",
      symbol: "CASPER",
      description:
        "The anonymous governance & utility token of the GHOSTFACE ecosystem. Used for encrypted voting, premium feature access, and ghost-node staking.",
      decimals: 9,
      totalSupply: 1_000_000_000,
      logoColor: "#00C8FF",
      notes: "Core ecosystem token — governance, staking, and utility.",
    },
    {
      name: "FaceZero",
      symbol: "FZ",
      description:
        "FaceZero (FZ) is the privacy-first payment rail for GHOSTFACE. Peer-to-peer transfers, paywall access, and cross-chain bridging.",
      decimals: 6,
      totalSupply: 500_000_000,
      logoColor: "#9945FF",
      notes: "Payment rail token — transfers, paywall, bridging.",
    },
  ]);
}

ensureSeedTokens().catch((err: unknown) => logger.error({ err }, "Token seed failed"));

// ── GET /api/tokens ───────────────────────────────────────────────────────────
router.get("/tokens", async (_req: Request, res: Response) => {
  try {
    const tokens = await db.select().from(tokensTable).orderBy(tokensTable.id);
    return res.json({ data: tokens });
  } catch (err) {
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

// ── GET /api/tokens/:id ───────────────────────────────────────────────────────
router.get("/tokens/:id", async (req: Request, res: Response) => {
  try {
    const [token] = await db
      .select()
      .from(tokensTable)
      .where(eq(tokensTable.id, Number(req.params.id)));
    if (!token) return res.status(404).json({ error: "Token not found" });
    return res.json({ data: token });
  } catch (err) {
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

// ── POST /api/tokens ──────────────────────────────────────────────────────────
router.post("/tokens", async (req: Request, res: Response) => {
  try {
    const { name, symbol, description, decimals, totalSupply, logoColor, notes } = req.body;
    if (!name || !symbol) return res.status(400).json({ error: "name and symbol are required" });
    const [token] = await db
      .insert(tokensTable)
      .values({
        name,
        symbol: symbol.toUpperCase(),
        description,
        decimals: decimals ?? 9,
        totalSupply: totalSupply ?? 1_000_000_000,
        logoColor: logoColor ?? "#00C8FF",
        notes,
      })
      .returning();
    return res.status(201).json({ data: token });
  } catch (err) {
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

// ── PUT /api/tokens/:id ───────────────────────────────────────────────────────
router.put("/tokens/:id", async (req: Request, res: Response) => {
  try {
    const { name, symbol, description, decimals, totalSupply, logoColor, notes } = req.body;
    const [token] = await db
      .update(tokensTable)
      .set({ name, symbol, description, decimals, totalSupply, logoColor, notes })
      .where(eq(tokensTable.id, Number(req.params.id)))
      .returning();
    if (!token) return res.status(404).json({ error: "Token not found" });
    return res.json({ data: token });
  } catch (err) {
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

// ── DELETE /api/tokens/:id ────────────────────────────────────────────────────
router.delete("/tokens/:id", async (req: Request, res: Response) => {
  try {
    const [token] = await db
      .select()
      .from(tokensTable)
      .where(eq(tokensTable.id, Number(req.params.id)));
    if (!token) return res.status(404).json({ error: "Token not found" });
    if (token.status === "deployed")
      return res.status(400).json({ error: "Cannot delete a deployed token" });
    await db.delete(tokensTable).where(eq(tokensTable.id, Number(req.params.id)));
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

// ── POST /api/tokens/:id/deploy — Deploy to Solana (devnet by default) ───────
//
// Body: { network?: "devnet" | "mainnet-beta", mintAuthority?: string }
// network defaults to "devnet" — deploying a real, irreversible mainnet
// token requires explicitly passing { network: "mainnet-beta" }. This was
// previously hardcoded to mainnet-beta with no way to test safely first.
router.post("/tokens/:id/deploy", async (req: Request, res: Response) => {
  try {
    const [token] = await db
      .select()
      .from(tokensTable)
      .where(eq(tokensTable.id, Number(req.params.id)));
    if (!token) return res.status(404).json({ error: "Token not found" });
    if (token.status === "deployed")
      return res
        .status(400)
        .json({ error: "Token is already deployed", mintAddress: token.mintAddress });

    const requestedNetwork = req.body.network;
    if (requestedNetwork !== undefined && !isSolanaNetwork(requestedNetwork)) {
      return res.status(400).json({ error: 'network must be "devnet" or "mainnet-beta"' });
    }
    const network: SolanaNetwork = requestedNetwork ?? "devnet";

    const payer = getDeployerKeypair();
    if (!payer) {
      return res.status(503).json({
        error:
          "Deployer not configured. Set SOLANA_DEPLOYER_KEY (JSON array of 64 bytes).",
        setup: true,
      });
    }

    const mintAuthorityAddress = req.body.mintAuthority as string | undefined;
    let mintAuthorityPk: PublicKey = payer.publicKey;
    if (mintAuthorityAddress) {
      try {
        mintAuthorityPk = new PublicKey(mintAuthorityAddress);
      } catch {
        return res.status(400).json({ error: "Invalid mintAuthority address" });
      }
    }

    const connection = new Connection(getRpcUrl(network), "confirmed");
    let balance = await connection.getBalance(payer.publicKey);
    if (balance < 0.01 * LAMPORTS_PER_SOL && network === "devnet") {
      // Devnet SOL is free and only usable for testing — airdrop rather
      // than asking for manual funding.
      try {
        const sig = await connection.requestAirdrop(payer.publicKey, LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig, "confirmed");
        balance = await connection.getBalance(payer.publicKey);
      } catch (err) {
        logger.warn({ err: toErrorMessage(err) }, "[tokens/deploy] devnet airdrop failed");
      }
    }
    if (balance < 0.01 * LAMPORTS_PER_SOL) {
      return res.status(402).json({
        error: `Deployer needs ≥ 0.01 SOL on ${network}. Current: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
        deployerAddress: payer.publicKey.toBase58(),
        network,
        setup: true,
      });
    }

    // Mark as deploying
    await db.update(tokensTable).set({ status: "pending" }).where(eq(tokensTable.id, token.id));

    // Create mint
    const mint = await createMint(
      connection,
      payer,
      mintAuthorityPk,
      mintAuthorityPk,
      token.decimals,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID,
    );

    let mintSignature: string | null = null;
    if (!mintAuthorityAddress || mintAuthorityPk.equals(payer.publicKey)) {
      const ata = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey);
      const rawSupply = BigInt(token.totalSupply) * BigInt(10 ** token.decimals);
      mintSignature = await mintTo(connection, payer, mint, ata.address, payer, rawSupply);
    }

    const mintAddress = mint.toBase58();
    const explorerUrl =
      network === "devnet"
        ? `https://solscan.io/token/${mintAddress}?cluster=devnet`
        : `https://solscan.io/token/${mintAddress}`;

    await db
      .update(tokensTable)
      .set({
        status: "deployed",
        mintAddress,
        deploySignature: mintSignature,
        explorerUrl,
        network,
        deployedAt: new Date(),
      })
      .where(eq(tokensTable.id, token.id));

    const [updated] = await db.select().from(tokensTable).where(eq(tokensTable.id, token.id));
    return res.json({ success: true, data: updated });
  } catch (err) {
    // Mark as failed
    try {
      await db
        .update(tokensTable)
        .set({ status: "failed" })
        .where(eq(tokensTable.id, Number(req.params.id)));
    } catch {
      /* best-effort rollback — ignore secondary failure */
    }
    logger.error({ err }, "[tokens/deploy]");
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

// ── GET /admin — Token management admin dashboard ─────────────────────────────
router.get("/admin", (_req: Request, res: Response) => {
  const API = `/api`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>GHOSTFACE · TOKEN ADMIN</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  :root{
    --bg:#000;--card:#0a0a0a;--border:#1a1a1a;--border2:#222;
    --fg:#f0f0f0;--muted:#555;--primary:#00C8FF;--sol:#9945FF;
    --success:#00FF88;--danger:#FF3B30;--gold:#D4AF37;--red:#b91c1c;
    --radius:10px;--mono:'Geist Mono',monospace;
  }
  html,body{background:var(--bg);color:var(--fg);font-family:var(--mono);min-height:100vh}
  body{padding:0 0 60px}

  /* ── top bar ── */
  .topbar{
    background:rgba(0,0,0,0.95);border-bottom:1px solid var(--border2);
    padding:16px 24px;display:flex;align-items:center;justify-content:space-between;
    position:sticky;top:0;z-index:100;backdrop-filter:blur(8px);
  }
  .topbar-logo{display:flex;align-items:center;gap:12px}
  .topbar-logo svg{width:28px;height:28px}
  .topbar-title{font-size:14px;font-weight:800;letter-spacing:4px;color:var(--fg)}
  .topbar-sub{font-size:10px;letter-spacing:2px;color:var(--muted);margin-top:2px}
  .topbar-right{display:flex;align-items:center;gap:12px}
  .status-dot{width:8px;height:8px;border-radius:50%;background:var(--success);box-shadow:0 0 6px var(--success)}
  .status-txt{font-size:10px;letter-spacing:2px;color:var(--success)}

  /* ── main ── */
  .main{max-width:900px;margin:0 auto;padding:32px 20px}
  .section-title{font-size:10px;font-weight:800;letter-spacing:4px;color:var(--muted);margin-bottom:16px;display:flex;align-items:center;gap:10px}
  .section-title::after{content:'';flex:1;height:1px;background:var(--border2)}

  /* ── token cards ── */
  .token-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:40px}
  @media(max-width:600px){.token-grid{grid-template-columns:1fr}}
  .token-card{
    background:var(--card);border:1px solid var(--border2);border-radius:var(--radius);
    padding:20px;display:flex;flex-direction:column;gap:14px;position:relative;overflow:hidden;
    transition:border-color .2s;
  }
  .token-card:hover{border-color:var(--border)}
  .token-card::before{
    content:'';position:absolute;top:0;left:0;right:0;height:2px;
    background:var(--accent,var(--primary));
  }
  .token-card-head{display:flex;align-items:flex-start;justify-content:space-between}
  .token-symbol{font-size:22px;font-weight:900;letter-spacing:3px}
  .token-name{font-size:11px;color:var(--muted);letter-spacing:2px;margin-top:2px}
  .token-badge{
    font-size:9px;font-weight:800;letter-spacing:2px;
    padding:4px 10px;border-radius:4px;
  }
  .badge-pending{background:rgba(255,200,0,0.1);color:#ffc800;border:1px solid rgba(255,200,0,0.2)}
  .badge-deployed{background:rgba(0,255,136,0.1);color:var(--success);border:1px solid rgba(0,255,136,0.2)}
  .badge-failed{background:rgba(255,59,48,0.1);color:var(--danger);border:1px solid rgba(255,59,48,0.2)}
  .token-desc{font-size:11px;color:var(--muted);line-height:1.6;letter-spacing:.5px}
  .token-meta{display:flex;flex-direction:column;gap:6px}
  .meta-row{display:flex;justify-content:space-between;align-items:center}
  .meta-label{font-size:9px;letter-spacing:2px;color:var(--muted)}
  .meta-value{font-size:11px;font-weight:700;letter-spacing:1px}
  .mint-box{
    background:rgba(0,0,0,0.5);border:1px solid var(--border);border-radius:6px;
    padding:10px 12px;font-size:10px;letter-spacing:1px;
    display:flex;align-items:center;gap:8px;overflow:hidden;
  }
  .mint-addr{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg);opacity:.7}
  .copy-btn{
    background:none;border:1px solid var(--border2);border-radius:4px;
    padding:4px 8px;color:var(--muted);font-size:9px;letter-spacing:1px;
    cursor:pointer;font-family:var(--mono);transition:all .15s;white-space:nowrap;
  }
  .copy-btn:hover{border-color:var(--muted);color:var(--fg)}

  /* ── buttons ── */
  .btn{
    display:inline-flex;align-items:center;justify-content:center;gap:8px;
    border:none;border-radius:var(--radius);font-family:var(--mono);
    font-size:11px;font-weight:800;letter-spacing:3px;cursor:pointer;
    padding:12px 20px;transition:opacity .15s;width:100%;
  }
  .btn:disabled{opacity:.4;cursor:not-allowed}
  .btn:hover:not(:disabled){opacity:.85}
  .btn-deploy{background:var(--accent,var(--sol));color:#fff}
  .btn-explorer{background:transparent;border:1px solid var(--border2);color:var(--muted);font-size:10px;padding:9px 16px}
  .btn-explorer:hover:not(:disabled){border-color:var(--muted);color:var(--fg)}
  .btn-add{background:var(--primary);color:#000;width:auto;padding:11px 24px}
  .btn-danger{background:transparent;border:1px solid rgba(255,59,48,.3);color:var(--danger);font-size:10px;padding:8px 14px;width:auto}

  /* ── add token form ── */
  .form-card{background:var(--card);border:1px solid var(--border2);border-radius:var(--radius);padding:24px;margin-bottom:40px}
  .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
  @media(max-width:600px){.form-grid{grid-template-columns:1fr}}
  .form-group{display:flex;flex-direction:column;gap:6px}
  .form-group label{font-size:9px;letter-spacing:3px;color:var(--muted);font-weight:700}
  .form-group input,.form-group textarea,.form-group select{
    background:#111;border:1px solid var(--border2);border-radius:6px;
    padding:10px 14px;color:var(--fg);font-family:var(--mono);font-size:12px;
    letter-spacing:1px;outline:none;transition:border-color .15s;
  }
  .form-group input:focus,.form-group textarea:focus{border-color:var(--primary)}
  .form-group textarea{resize:vertical;min-height:72px}
  .form-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}

  /* ── deployer info box ── */
  .deployer-box{
    background:rgba(153,69,255,.06);border:1px solid rgba(153,69,255,.2);
    border-radius:var(--radius);padding:16px 20px;margin-bottom:32px;
    display:flex;align-items:flex-start;gap:14px;
  }
  .deployer-icon{font-size:20px;flex-shrink:0}
  .deployer-content{flex:1}
  .deployer-title{font-size:10px;font-weight:800;letter-spacing:3px;color:var(--sol);margin-bottom:6px}
  .deployer-text{font-size:11px;color:var(--muted);line-height:1.6}
  .deployer-addr{
    font-size:11px;color:var(--fg);background:#111;
    border:1px solid var(--border2);border-radius:6px;
    padding:8px 12px;margin-top:10px;letter-spacing:1px;
    display:flex;align-items:center;gap:8px;
  }
  .deployer-addr span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .sol-bal{color:var(--sol);font-weight:800}

  /* ── toast ── */
  .toast{
    position:fixed;bottom:24px;right:24px;z-index:999;
    background:var(--card);border:1px solid var(--border2);border-radius:var(--radius);
    padding:14px 20px;font-size:12px;letter-spacing:1px;max-width:340px;
    display:none;animation:slideup .3s ease;
  }
  .toast.show{display:block}
  .toast.success{border-color:rgba(0,255,136,.3);color:var(--success)}
  .toast.error{border-color:rgba(255,59,48,.3);color:var(--danger)}
  @keyframes slideup{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}

  /* ── modal ── */
  .modal-overlay{
    display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);
    z-index:200;align-items:center;justify-content:center;padding:20px;
  }
  .modal-overlay.open{display:flex}
  .modal{
    background:var(--card);border:1px solid var(--border2);border-radius:14px;
    padding:28px;max-width:480px;width:100%;
  }
  .modal h3{font-size:13px;font-weight:800;letter-spacing:4px;margin-bottom:8px}
  .modal p{font-size:11px;color:var(--muted);letter-spacing:1px;line-height:1.6;margin-bottom:20px}
  .modal-actions{display:flex;gap:10px}
  .modal .btn{flex:1}
  .btn-cancel{background:transparent;border:1px solid var(--border2);color:var(--muted)}

  /* ── spinning loader ── */
  .spin{display:inline-block;animation:spin .7s linear infinite}
  @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}

  hr.divider{border:none;border-top:1px solid var(--border2);margin:32px 0}
</style>
</head>
<body>

<!-- Top bar -->
<nav class="topbar">
  <div class="topbar-logo">
    <svg viewBox="0 0 40 40" fill="none">
      <circle cx="20" cy="20" r="19" stroke="#00C8FF" stroke-width="1.5"/>
      <path d="M13 16c0-3.866 3.134-7 7-7s7 3.134 7 7v4c0 2.5-1.5 4.5-3.5 5.5L20 28l-3.5-2.5C14.5 24.5 13 22.5 13 20v-4z" fill="#00C8FF" fill-opacity=".15" stroke="#00C8FF" stroke-width="1.2"/>
      <circle cx="16.5" cy="18" r="1.5" fill="#00C8FF"/>
      <circle cx="23.5" cy="18" r="1.5" fill="#00C8FF"/>
    </svg>
    <div>
      <div class="topbar-title">GHOSTFACE</div>
      <div class="topbar-sub">TOKEN ADMIN</div>
    </div>
  </div>
  <div class="topbar-right">
    <div class="status-dot" id="apiDot" style="background:var(--muted)"></div>
    <div class="status-txt" id="apiStatus">CONNECTING...</div>
  </div>
</nav>

<main class="main">

  <!-- Deployer info -->
  <div id="deployerBox" class="deployer-box" style="display:none">
    <div class="deployer-icon">⬡</div>
    <div class="deployer-content">
      <div class="deployer-title">SOLANA DEPLOYER</div>
      <div class="deployer-text" id="deployerText">Loading deployer info…</div>
      <div class="deployer-addr" id="deployerAddrRow" style="display:none">
        <span id="deployerAddr"></span>
        <button class="copy-btn" onclick="copyText(document.getElementById('deployerAddr').textContent)">COPY</button>
      </div>
    </div>
  </div>

  <!-- Tokens section -->
  <div class="section-title">TOKENS</div>
  <div class="token-grid" id="tokenGrid">
    <div style="color:var(--muted);font-size:11px;letter-spacing:2px;grid-column:1/-1;padding:20px 0">
      LOADING TOKENS…
    </div>
  </div>

  <hr class="divider"/>

  <!-- Add token form -->
  <div class="section-title">ADD TOKEN</div>
  <div class="form-card">
    <div class="form-grid">
      <div class="form-group">
        <label>TOKEN NAME</label>
        <input id="fName" placeholder="e.g. CASPER" autocomplete="off"/>
      </div>
      <div class="form-group">
        <label>SYMBOL</label>
        <input id="fSymbol" placeholder="e.g. CSP" autocomplete="off" style="text-transform:uppercase"/>
      </div>
      <div class="form-group">
        <label>DECIMALS</label>
        <input id="fDecimals" type="number" value="9" min="0" max="18"/>
      </div>
      <div class="form-group">
        <label>TOTAL SUPPLY</label>
        <input id="fSupply" type="number" value="1000000000"/>
      </div>
      <div class="form-group">
        <label>ACCENT COLOR (HEX)</label>
        <input id="fColor" value="#00C8FF" placeholder="#00C8FF"/>
      </div>
      <div class="form-group" style="align-self:end">
        <label>&nbsp;</label>
        <div style="display:flex;align-items:center;gap:8px">
          <input type="color" id="fColorPicker" value="#00C8FF" style="width:40px;height:40px;border:none;background:none;cursor:pointer;padding:0" oninput="document.getElementById('fColor').value=this.value"/>
          <span style="font-size:10px;color:var(--muted);letter-spacing:1px">PICK COLOUR</span>
        </div>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:16px">
      <label>DESCRIPTION</label>
      <textarea id="fDesc" placeholder="Describe what this token does…"></textarea>
    </div>
    <div class="form-actions">
      <button class="btn btn-add" id="btnAdd" onclick="addToken()">+ ADD TOKEN</button>
      <span id="addStatus" style="font-size:10px;letter-spacing:2px;color:var(--muted)"></span>
    </div>
  </div>

</main>

<!-- Confirm deploy modal -->
<div class="modal-overlay" id="deployModal">
  <div class="modal">
    <h3 id="modalTitle">DEPLOY TOKEN</h3>
    <p id="modalBody">Deploy this token to Solana mainnet? This action is irreversible.</p>
    <div class="modal-actions">
      <button class="btn btn-cancel" onclick="closeModal()">CANCEL</button>
      <button class="btn btn-deploy" id="modalConfirmBtn" onclick="confirmDeploy()">DEPLOY</button>
    </div>
  </div>
</div>

<!-- Toast -->
<div class="toast" id="toast"></div>

<script>
const API = '${API}';
let deployingId = null;
let allTokens = [];

// ── Utilities ─────────────────────────────────────────────────────────────────
function toast(msg, type='success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  setTimeout(() => el.className='toast', 3500);
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard'));
}

function formatNumber(n) {
  return Number(n).toLocaleString();
}

function formatDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-NZ', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}

// ── API status + deployer ─────────────────────────────────────────────────────
async function checkDeployer() {
  try {
    const r = await fetch(API + '/wallet/deployer');
    const d = await r.json();
    const box = document.getElementById('deployerBox');
    box.style.display = 'flex';
    if (d.configured) {
      const bal = d.solBalance !== null ? d.solBalance.toFixed(4) : '?';
      const balColor = d.solBalance >= 0.01 ? 'var(--success)' : 'var(--danger)';
      document.getElementById('deployerText').innerHTML =
        'Deployer wallet is configured. SOL balance: <span class="sol-bal" style="color:'+balColor+'">'+bal+' SOL</span>';
      const row = document.getElementById('deployerAddrRow');
      row.style.display = 'flex';
      document.getElementById('deployerAddr').textContent = d.publicKey;
    } else {
      document.getElementById('deployerText').textContent =
        'No deployer configured. Set SOLANA_DEPLOYER_KEY in your environment secrets to enable on-chain deployment.';
    }
  } catch {}
}

async function checkApi() {
  try {
    const r = await fetch(API + '/tokens');
    const ok = r.ok;
    document.getElementById('apiDot').style.background = ok ? 'var(--success)' : 'var(--danger)';
    document.getElementById('apiStatus').textContent = ok ? 'API LIVE' : 'API ERROR';
    document.getElementById('apiStatus').style.color = ok ? 'var(--success)' : 'var(--danger)';
  } catch {
    document.getElementById('apiDot').style.background = 'var(--danger)';
    document.getElementById('apiStatus').textContent = 'API OFFLINE';
    document.getElementById('apiStatus').style.color = 'var(--danger)';
  }
}

// ── Load + render tokens ──────────────────────────────────────────────────────
async function loadTokens() {
  try {
    const r = await fetch(API + '/tokens');
    const { data } = await r.json();
    allTokens = data || [];
    renderTokens();
  } catch (e) {
    document.getElementById('tokenGrid').innerHTML =
      '<div style="color:var(--danger);font-size:11px;letter-spacing:2px;grid-column:1/-1">FAILED TO LOAD TOKENS</div>';
  }
}

function renderTokens() {
  const grid = document.getElementById('tokenGrid');
  if (!allTokens.length) {
    grid.innerHTML = '<div style="color:var(--muted);font-size:11px;letter-spacing:2px;grid-column:1/-1;padding:20px 0">NO TOKENS YET. ADD ONE BELOW.</div>';
    return;
  }
  grid.innerHTML = allTokens.map(t => {
    const color = t.logoColor || '#00C8FF';
    const statusBadge = {
      pending: '<span class="token-badge badge-pending">PENDING</span>',
      deployed: '<span class="token-badge badge-deployed">DEPLOYED</span>',
      failed: '<span class="token-badge badge-failed">FAILED</span>',
    }[t.status] || '';
    const mintSection = t.mintAddress ? \`
      <div class="mint-box">
        <span class="mint-addr" title="\${t.mintAddress}">\${t.mintAddress}</span>
        <button class="copy-btn" onclick="copyText('\${t.mintAddress}')">COPY</button>
      </div>
      <button class="btn btn-explorer" onclick="window.open('\${t.explorerUrl}','_blank')">
        ↗ VIEW ON SOLSCAN
      </button>
    \` : '';
    const deployBtn = t.status !== 'deployed' ? \`
      <button class="btn btn-deploy" style="background:\${color}" onclick="openDeploy(\${t.id})">
        <span id="deployLabel-\${t.id}">⬡ DEPLOY TO SOLANA</span>
      </button>
    \` : '';
    return \`
      <div class="token-card" style="--accent:\${color}">
        <div class="token-card-head">
          <div>
            <div class="token-symbol" style="color:\${color}">\${t.symbol}</div>
            <div class="token-name">\${t.name}</div>
          </div>
          \${statusBadge}
        </div>
        \${t.description ? \`<div class="token-desc">\${t.description}</div>\` : ''}
        <div class="token-meta">
          <div class="meta-row">
            <span class="meta-label">SUPPLY</span>
            <span class="meta-value">\${formatNumber(t.totalSupply)}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">DECIMALS</span>
            <span class="meta-value">\${t.decimals}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">NETWORK</span>
            <span class="meta-value" style="color:var(--sol)">\${t.network || 'mainnet-beta'}</span>
          </div>
          \${t.deployedAt ? \`<div class="meta-row">
            <span class="meta-label">DEPLOYED</span>
            <span class="meta-value">\${formatDate(t.deployedAt)}</span>
          </div>\` : ''}
        </div>
        \${mintSection}
        \${deployBtn}
        \${t.status !== 'deployed' ? \`<button class="btn btn-danger" onclick="deleteToken(\${t.id},'\\'\${t.symbol}\\'')">DELETE</button>\` : ''}
      </div>
    \`;
  }).join('');
}

// ── Deploy flow ───────────────────────────────────────────────────────────────
function openDeploy(id) {
  const token = allTokens.find(t => t.id === id);
  if (!token) return;
  deployingId = id;
  document.getElementById('modalTitle').textContent = 'DEPLOY ' + token.symbol;
  document.getElementById('modalBody').textContent =
    'Deploy ' + token.name + ' (' + token.symbol + ') to Solana mainnet? Supply: ' +
    formatNumber(token.totalSupply) + ' tokens with ' + token.decimals + ' decimals. This is irreversible.';
  document.getElementById('deployModal').classList.add('open');
}

function closeModal() {
  document.getElementById('deployModal').classList.remove('open');
  deployingId = null;
}

async function confirmDeploy() {
  if (!deployingId) return;
  const btn = document.getElementById('modalConfirmBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin">⟳</span> DEPLOYING…';
  try {
    const r = await fetch(API + '/tokens/' + deployingId + '/deploy', { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' });
    const d = await r.json();
    closeModal();
    if (d.success) {
      toast('✓ ' + d.data.symbol + ' deployed! Mint: ' + d.data.mintAddress.slice(0,12) + '…', 'success');
      await loadTokens();
    } else {
      toast('✗ ' + (d.error || 'Deploy failed'), 'error');
      if (d.setup) toast('Set SOLANA_DEPLOYER_KEY in environment secrets and fund with SOL.', 'error');
    }
  } catch (e) {
    closeModal();
    toast('✗ Network error', 'error');
  }
  btn.disabled = false;
  btn.innerHTML = 'DEPLOY';
}

// ── Add token ─────────────────────────────────────────────────────────────────
async function addToken() {
  const name = document.getElementById('fName').value.trim();
  const symbol = document.getElementById('fSymbol').value.trim().toUpperCase();
  const decimals = parseInt(document.getElementById('fDecimals').value) || 9;
  const totalSupply = parseInt(document.getElementById('fSupply').value) || 1_000_000_000;
  const logoColor = document.getElementById('fColor').value || '#00C8FF';
  const description = document.getElementById('fDesc').value.trim();
  if (!name || !symbol) { toast('Name and symbol are required', 'error'); return; }
  const btn = document.getElementById('btnAdd');
  btn.disabled = true;
  document.getElementById('addStatus').textContent = 'CREATING…';
  try {
    const r = await fetch(API + '/tokens', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name, symbol, decimals, totalSupply, logoColor, description }),
    });
    const d = await r.json();
    if (r.ok) {
      toast('✓ ' + symbol + ' token created', 'success');
      document.getElementById('fName').value='';
      document.getElementById('fSymbol').value='';
      document.getElementById('fDesc').value='';
      document.getElementById('addStatus').textContent='';
      await loadTokens();
    } else {
      toast('✗ ' + (d.error || 'Failed'), 'error');
      document.getElementById('addStatus').textContent='';
    }
  } catch {
    toast('✗ Network error', 'error');
    document.getElementById('addStatus').textContent='';
  }
  btn.disabled = false;
}

// ── Delete token ──────────────────────────────────────────────────────────────
async function deleteToken(id, label) {
  if (!confirm('Delete ' + label + '? This cannot be undone.')) return;
  try {
    const r = await fetch(API + '/tokens/' + id, { method:'DELETE' });
    const d = await r.json();
    if (r.ok) { toast('Token deleted', 'success'); await loadTokens(); }
    else toast('✗ ' + (d.error || 'Delete failed'), 'error');
  } catch { toast('✗ Network error', 'error'); }
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  await Promise.all([checkApi(), checkDeployer(), loadTokens()]);
})();

// Sync color picker <-> hex input
document.getElementById('fColor').addEventListener('input', function() {
  if (/^#[0-9a-fA-F]{6}$/.test(this.value)) {
    document.getElementById('fColorPicker').value = this.value;
  }
});
</script>
</body>
</html>`);
});

export default router;
