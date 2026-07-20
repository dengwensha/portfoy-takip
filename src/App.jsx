import React, { useState, useEffect, useMemo, useCallback } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { Plus, Trash2, RefreshCw, TrendingUp, TrendingDown, Wallet, Settings, Key } from "lucide-react";

const COIN_CATALOG = [
  { symbol: "BTC", id: "bitcoin", name: "Bitcoin" },
  { symbol: "ETH", id: "ethereum", name: "Ethereum" },
  { symbol: "BNB", id: "binancecoin", name: "BNB" },
  { symbol: "SOL", id: "solana", name: "Solana" },
  { symbol: "XRP", id: "ripple", name: "XRP" },
  { symbol: "ADA", id: "cardano", name: "Cardano" },
  { symbol: "DOGE", id: "dogecoin", name: "Dogecoin" },
  { symbol: "AVAX", id: "avalanche-2", name: "Avalanche" },
  { symbol: "DOT", id: "polkadot", name: "Polkadot" },
  { symbol: "MATIC", id: "matic-network", name: "Polygon" },
  { symbol: "LTC", id: "litecoin", name: "Litecoin" },
  { symbol: "TRX", id: "tron", name: "TRON" },
  { symbol: "LINK", id: "chainlink", name: "Chainlink" },
  { symbol: "ATOM", id: "cosmos", name: "Cosmos" },
  { symbol: "TON", id: "the-open-network", name: "Toncoin" },
  { symbol: "SHIB", id: "shiba-inu", name: "Shiba Inu" },
  { symbol: "USDT", id: "tether", name: "Tether" },
  { symbol: "USDC", id: "usd-coin", name: "USD Coin" },
];

const EVM_PLATFORMS = [
  "ethereum",
  "binance-smart-chain",
  "polygon-pos",
  "arbitrum-one",
  "optimistic-ethereum",
  "base",
  "avalanche",
  "fantom",
];
const SOLANA_PLATFORM = "solana";
const TON_PLATFORM = "the-open-network";

const isEvmAddress = (q) => /^0x[a-fA-F0-9]{40}$/.test(q.trim());
const isSolanaAddress = (q) => !q.trim().startsWith("0x") && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q.trim());
const isTonAddress = (q) => /^(EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46}$/.test(q.trim());

const cgUrl = (url, apiKey) => {
  if (!apiKey) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}x_cg_demo_api_key=${encodeURIComponent(apiKey)}`;
};

async function searchByContract(address, apiKey) {
  const platforms = isEvmAddress(address)
    ? EVM_PLATFORMS
    : isTonAddress(address)
    ? [TON_PLATFORM]
    : [SOLANA_PLATFORM];
  const attempts = await Promise.allSettled(
    platforms.map(async (platform) => {
      const res = await fetch(
        cgUrl(`https://api.coingecko.com/api/v3/coins/${platform}/contract/${address}`, apiKey)
      );
      if (!res.ok) throw new Error("not found on " + platform);
      const data = await res.json();
      return { platform, data };
    })
  );
  const hit = attempts.find((r) => r.status === "fulfilled");
  if (!hit) return null;
  const { data, platform } = hit.value;
  return {
    id: data.id,
    symbol: data.symbol,
    name: data.name,
    thumb: data.image?.thumb,
    market_cap_rank: data.market_cap_rank,
    contractPlatform: platform,
  };
}

const EXCHANGES = ["Binance", "BtcTurk", "Paribu", "MEXC", "Bybit", "OKX", "Coinbase"];
const CUSTOM_EXCHANGE = "__custom__";

// --- Daily buy/sell suggestion (technical, rule-based — not financial advice) ---

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function sma(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(closes.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

async function fetchDailyCloses(coinId, apiKey) {
  const url = cgUrl(
    `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=30&interval=daily`,
    apiKey
  );
  const res = await fetch(url);
  if (!res.ok) throw new Error("history fetch failed");
  const data = await res.json();
  return (data.prices || []).map((p) => p[1]);
}

function computeSignal(closes, change24h) {
  if (!closes || closes.length < 8) return null;
  const rsi = calcRSI(closes, 14);
  const maShort = sma(closes, 7);
  const maLong = sma(closes, Math.min(25, closes.length - 1));
  const last = closes[closes.length - 1];
  const weekAgo = closes[Math.max(0, closes.length - 8)];
  const change7d = weekAgo ? ((last - weekAgo) / weekAgo) * 100 : null;

  let score = 0;
  const reasons = [];

  if (rsi != null) {
    if (rsi < 30) {
      score += 1;
      reasons.push(`RSI ${rsi.toFixed(0)} — aşırı satım bölgesinde`);
    } else if (rsi > 70) {
      score -= 1;
      reasons.push(`RSI ${rsi.toFixed(0)} — aşırı alım bölgesinde`);
    } else {
      reasons.push(`RSI ${rsi.toFixed(0)} — nötr bölge`);
    }
  }

  if (maShort != null && maLong != null) {
    if (maShort > maLong) {
      score += 1;
      reasons.push("7 günlük ortalama 25 günlüğün üzerinde — kısa vadeli momentum yukarı");
    } else {
      score -= 1;
      reasons.push("7 günlük ortalama 25 günlüğün altında — kısa vadeli momentum aşağı");
    }
  }

  if (change7d != null) {
    if (change7d > 5) score += 0.5;
    else if (change7d < -5) score -= 0.5;
  }
  if (change24h != null) {
    if (change24h > 3) score += 0.5;
    else if (change24h < -3) score -= 0.5;
  }

  let suggestion = "BEKLE";
  if (score >= 1.5) suggestion = "AL";
  else if (score <= -1.5) suggestion = "SAT";

  return { suggestion, score, rsi, maShort, maLong, change7d, reasons };
}

const SIGNAL_COLORS = { AL: "var(--teal)", SAT: "var(--coral)", BEKLE: "var(--muted)" };

const FALLBACK_COLORS = ["#E8A33D", "#2DD4BF", "#7C9CF0", "#F2A65A", "#8CE0D0", "#5B8DEF", "#C792EA", "#F28FAD", "#A3E635", "#8A93A6"];

const EXCHANGE_COLORS = {
  Binance: "#E8A33D",
  BtcTurk: "#2DD4BF",
  Paribu: "#7C9CF0",
  MEXC: "#5FD3A0",
  Bybit: "#F2A65A",
  OKX: "#8CE0D0",
  Coinbase: "#5B8DEF",
};

// deterministic color for any exchange name not in the preset map (e.g. custom-typed ones)
const colorForExchange = (name) => {
  if (EXCHANGE_COLORS[name]) return EXCHANGE_COLORS[name];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
};

const fmtUSD = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 1 ? 6 : 2 });

const fmtPct = (n) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export default function PortfolioTracker() {
  const [holdings, setHoldings] = useState([]);
  const [prices, setPrices] = useState({});
  const [loading, setLoading] = useState(false);
  const [priceError, setPriceError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  const [form, setForm] = useState({
    exchange: EXCHANGES[0],
    customExchange: "",
    coinId: COIN_CATALOG[0].id,
    amount: "",
    buyPrice: "",
  });

  const [extraCoins, setExtraCoins] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedSearchCoin, setSelectedSearchCoin] = useState(null);
  const [tickers, setTickers] = useState([]);
  const [tickersLoading, setTickersLoading] = useState(false);
  const [tickersError, setTickersError] = useState(null);
  const [searchNotice, setSearchNotice] = useState(null);
  const [valueHistory, setValueHistory] = useState([]);
  const [signals, setSignals] = useState({});
  const [signalsLoading, setSignalsLoading] = useState(false);

  // load persisted holdings + api key (localStorage — this runs as a real website, not a Claude artifact)
  useEffect(() => {
    try {
      const raw = localStorage.getItem("holdings");
      if (raw) setHoldings(JSON.parse(raw));
    } catch (e) {
      // no saved data yet
    }
    try {
      const key = localStorage.getItem("cg_api_key");
      if (key) {
        setApiKey(key);
        setApiKeyInput(key);
      }
    } catch (e) {
      // no saved key yet
    } finally {
      setLoaded(true);
    }
  }, []);

  // persist on change
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem("holdings", JSON.stringify(holdings));
    } catch (e) {
      // storage full or unavailable
    }
  }, [holdings, loaded]);

  const saveApiKey = () => {
    const trimmed = apiKeyInput.trim();
    setApiKey(trimmed);
    try {
      localStorage.setItem("cg_api_key", trimmed);
    } catch (e) {
      // storage full or unavailable
    }
    setShowSettings(false);
  };

  const allCoins = useMemo(() => {
    const map = new Map(COIN_CATALOG.map((c) => [c.id, c]));
    extraCoins.forEach((c) => map.set(c.id, c));
    return [...map.values()];
  }, [extraCoins]);

  // debounced coin search — supports name/symbol OR a pasted contract address
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearchNotice(null);
      return;
    }
    const t = setTimeout(async () => {
      setSearchLoading(true);
      setSearchNotice(null);
      try {
        if (isEvmAddress(q) || isSolanaAddress(q) || isTonAddress(q)) {
          const found = await searchByContract(q, apiKey);
          setSearchResults(found ? [found] : []);
          if (!found) setSearchNotice("Bu sözleşme adresi desteklenen zincirlerde bulunamadı.");
        } else {
          const res = await fetch(
            cgUrl(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`, apiKey)
          );
          if (!res.ok) {
            if (res.status === 429) {
              setSearchNotice(
                apiKey
                  ? "Fiyat servisi çok istek aldı, birkaç saniye sonra tekrar dene."
                  : "Hız limitine takıldın. Ayarlar'dan ücretsiz bir CoinGecko API anahtarı eklersen bu sorun geçer."
              );
            } else {
              setSearchNotice("Arama şu an yapılamadı, birazdan tekrar dene.");
            }
            setSearchResults([]);
            return;
          }
          const data = await res.json();
          setSearchResults((data.coins || []).slice(0, 8));
          if ((data.coins || []).length === 0) {
            setSearchNotice("Sonuç bulunamadı.");
          }
        }
      } catch (e) {
        setSearchResults([]);
        setSearchNotice(`Arama yapılamadı (${e.message || "bilinmeyen hata"}). Birazdan tekrar dene.`);
      } finally {
        setSearchLoading(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [searchQuery, apiKey]);

  const loadTickers = useCallback(
    async (coin) => {
      setSelectedSearchCoin(coin);
      setTickers([]);
      setTickersError(null);
      setTickersLoading(true);
      try {
        const res = await fetch(
          cgUrl(
            `https://api.coingecko.com/api/v3/coins/${coin.id}/tickers?include_exchange_logo=false`,
            apiKey
          )
        );
        if (!res.ok) throw new Error("borsa listesi alınamadı");
        const data = await res.json();
        const byExchangeName = new Map();
        (data.tickers || []).forEach((t) => {
          const name = t.market?.name;
          if (!name) return;
          const existing = byExchangeName.get(name);
          if (!existing || (t.converted_volume?.usd || 0) > (existing.converted_volume?.usd || 0)) {
            byExchangeName.set(name, t);
          }
        });
        const list = [...byExchangeName.values()]
          .sort((a, b) => (b.converted_volume?.usd || 0) - (a.converted_volume?.usd || 0))
          .slice(0, 15);
        setTickers(list);
      } catch (e) {
        setTickersError("Borsa listesi alınamadı, birazdan tekrar dene.");
      } finally {
        setTickersLoading(false);
      }
    },
    [apiKey]
  );

  const addFromSearch = (coin, exchangeName) => {
    if (!allCoins.find((c) => c.id === coin.id)) {
      setExtraCoins((prev) => [...prev, { id: coin.id, symbol: coin.symbol.toUpperCase(), name: coin.name }]);
    }
    const preset = EXCHANGES.find((e) => e.toLowerCase() === exchangeName.toLowerCase());
    setForm((f) => ({
      ...f,
      coinId: coin.id,
      exchange: preset || CUSTOM_EXCHANGE,
      customExchange: preset ? "" : exchangeName,
    }));
  };
  const uniqueCoinIds = useMemo(
    () => [...new Set(holdings.map((h) => h.coinId))],
    [holdings]
  );

  const coinIdsKey = uniqueCoinIds.join(",");

  // daily buy/sell suggestion per held coin (cached once per day per coin)
  useEffect(() => {
    if (!loaded || uniqueCoinIds.length === 0) return;
    const todayKey = new Date().toISOString().slice(0, 10);
    let cache = {};
    try {
      cache = JSON.parse(localStorage.getItem("signals_cache") || "{}");
    } catch (e) {
      cache = {};
    }

    const needsFetch = uniqueCoinIds.filter((id) => !cache[id] || cache[id].date !== todayKey);
    // show whatever we already have (from cache) immediately
    setSignals((prev) => ({ ...prev, ...cache }));
    if (needsFetch.length === 0) return;

    let cancelled = false;
    (async () => {
      setSignalsLoading(true);
      const updates = {};
      for (const coinId of needsFetch) {
        try {
          const closes = await fetchDailyCloses(coinId, apiKey);
          const change24hForCoin = prices[coinId]?.usd_24h_change ?? null;
          const sig = computeSignal(closes, change24hForCoin);
          if (sig) updates[coinId] = { ...sig, date: todayKey };
        } catch (e) {
          // skip this coin for today, keep old cached value if any
        }
      }
      if (cancelled) return;
      setSignals((prev) => {
        const next = { ...prev, ...updates };
        try {
          localStorage.setItem("signals_cache", JSON.stringify(next));
        } catch (e) {
          // storage full or unavailable
        }
        return next;
      });
      setSignalsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coinIdsKey, loaded, apiKey]);

  const fetchPrices = useCallback(async () => {
    if (uniqueCoinIds.length === 0) {
      setPrices({});
      return;
    }
    setLoading(true);
    setPriceError(null);
    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${uniqueCoinIds.join(
        ","
      )}&vs_currencies=usd&include_24hr_change=true`;
      const res = await fetch(cgUrl(url, apiKey));
      if (res.status === 429) {
        throw new Error(
          apiKey
            ? "rate-limited-with-key"
            : "rate-limited-no-key"
        );
      }
      if (!res.ok) throw new Error("fiyat servisi yanıt vermedi");
      const data = await res.json();
      setPrices(data);
    } catch (e) {
      setPriceError(
        e.message === "rate-limited-no-key"
          ? "Hız limitine takıldın. Ayarlar'dan ücretsiz bir CoinGecko API anahtarı eklersen bu sorun çözülür."
          : `Fiyatlar alınamadı (${e.message || "bilinmeyen hata"}). Birazdan tekrar denenecek.`
      );
    } finally {
      setLoading(false);
    }
  }, [uniqueCoinIds, apiKey]);

  useEffect(() => {
    fetchPrices();
    const interval = setInterval(fetchPrices, 60000);
    return () => clearInterval(interval);
  }, [fetchPrices]);

  const addHolding = () => {
    const amount = parseFloat(form.amount);
    const buyPrice = parseFloat(form.buyPrice);
    if (!amount || amount <= 0) return;
    const exchangeName =
      form.exchange === CUSTOM_EXCHANGE ? form.customExchange.trim() : form.exchange;
    if (!exchangeName) return;
    const coin = COIN_CATALOG.find((c) => c.id === form.coinId);
    setHoldings((prev) => [
      ...prev,
      {
        rid: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        exchange: exchangeName,
        coinId: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        amount,
        buyPrice: buyPrice > 0 ? buyPrice : null,
      },
    ]);
    setForm((f) => ({ ...f, amount: "", buyPrice: "", customExchange: "" }));
  };

  const removeHolding = (rid) => setHoldings((prev) => prev.filter((h) => h.rid !== rid));

  const enriched = useMemo(() => {
    return holdings.map((h) => {
      const p = prices[h.coinId];
      const currentPrice = p ? p.usd : null;
      const change24h = p ? p.usd_24h_change : null;
      const value = currentPrice != null ? currentPrice * h.amount : null;
      const cost = h.buyPrice != null ? h.buyPrice * h.amount : null;
      const pnl = value != null && cost != null ? value - cost : null;
      const pnlPct = value != null && cost != null && cost > 0 ? (pnl / cost) * 100 : null;
      return { ...h, currentPrice, change24h, value, cost, pnl, pnlPct };
    });
  }, [holdings, prices]);

  const totalValue = useMemo(
    () => enriched.reduce((s, h) => s + (h.value || 0), 0),
    [enriched]
  );
  const totalCost = useMemo(
    () => enriched.reduce((s, h) => s + (h.cost || 0), 0),
    [enriched]
  );
  const totalChange24 = useMemo(() => {
    const withValue = enriched.filter((h) => h.value != null && h.change24h != null);
    const val = withValue.reduce((s, h) => s + h.value, 0);
    if (val === 0) return 0;
    return withValue.reduce((s, h) => s + h.value * h.change24h, 0) / val;
  }, [enriched]);
  const totalPnl = totalCost > 0 ? totalValue - totalCost : null;
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : null;

  // --- 7-day value history ---
  const todayKey = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("value_history");
      if (raw) setValueHistory(JSON.parse(raw));
    } catch (e) {
      // no saved history yet
    }
  }, []);

  useEffect(() => {
    if (!loaded || totalValue <= 0) return;
    setValueHistory((prev) => {
      const idx = prev.findIndex((h) => h.date === todayKey);
      let next;
      if (idx >= 0) {
        next = [...prev];
        next[idx] = { date: todayKey, value: totalValue };
      } else {
        next = [...prev, { date: todayKey, value: totalValue }];
      }
      next.sort((a, b) => a.date.localeCompare(b.date));
      if (next.length > 7) next = next.slice(next.length - 7);
      return next;
    });
  }, [totalValue, loaded, todayKey]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem("value_history", JSON.stringify(valueHistory));
    } catch (e) {
      // storage full or unavailable
    }
  }, [valueHistory, loaded]);

  const dayLabel = (dateStr) => {
    const d = new Date(dateStr + "T00:00:00");
    const names = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
    return names[d.getDay()];
  };

  const historyChartData = useMemo(
    () => valueHistory.map((h) => ({ label: dayLabel(h.date), value: h.value, date: h.date })),
    [valueHistory]
  );

  const weeklyChange = useMemo(() => {
    if (valueHistory.length < 2) return null;
    const first = valueHistory[0].value;
    const last = valueHistory[valueHistory.length - 1].value;
    if (first === 0) return null;
    return { diff: last - first, pct: ((last - first) / first) * 100 };
  }, [valueHistory]);

  const byExchange = useMemo(() => {
    const map = {};
    enriched.forEach((h) => {
      if (!map[h.exchange]) map[h.exchange] = [];
      map[h.exchange].push(h);
    });
    return map;
  }, [enriched]);

  const pieData = useMemo(() => {
    return Object.entries(byExchange)
      .map(([ex, items]) => ({
        name: ex,
        value: items.reduce((s, h) => s + (h.value || 0), 0),
      }))
      .filter((d) => d.value > 0);
  }, [byExchange]);

  const tickerItems = enriched.filter((h) => h.currentPrice != null);

  return (
    <div className="pf-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap');

        .pf-root {
          --bg: #0E1420;
          --surface: #161D2C;
          --surface-hi: #1D2740;
          --line: #29334A;
          --amber: #E8A33D;
          --teal: #2DD4BF;
          --coral: #F2545B;
          --text: #EDEFF4;
          --muted: #8A93A6;
          background: var(--bg);
          color: var(--text);
          font-family: 'Inter', sans-serif;
          min-height: 100vh;
        }
        .pf-display { font-family: 'Space Grotesk', sans-serif; }
        .pf-mono { font-family: 'IBM Plex Mono', monospace; }

        .pf-ticker-wrap {
          background: var(--surface);
          border-bottom: 1px solid var(--line);
          overflow: hidden;
          white-space: nowrap;
          padding: 10px 0;
        }
        .pf-ticker-track {
          display: inline-flex;
          animation: pf-scroll 30s linear infinite;
        }
        .pf-ticker-track:hover { animation-play-state: paused; }
        @keyframes pf-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .pf-ticker-item {
          display: inline-flex;
          align-items: baseline;
          gap: 6px;
          padding: 0 20px;
          border-right: 1px solid var(--line);
          font-size: 13px;
        }
        @media (prefers-reduced-motion: reduce) {
          .pf-ticker-track { animation: none; overflow-x: auto; }
        }

        .pf-hero {
          padding: 28px 24px 20px;
          border-bottom: 1px solid var(--line);
        }
        .pf-hero-label {
          font-size: 12px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted);
          margin-bottom: 6px;
        }
        .pf-hero-value {
          font-size: 44px;
          font-weight: 700;
          line-height: 1;
        }
        .pf-card {
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 12px;
        }
        .pf-input, .pf-select {
          background: var(--surface-hi);
          border: 1px solid var(--line);
          color: var(--text);
          border-radius: 8px;
          padding: 9px 10px;
          font-size: 14px;
          font-family: inherit;
          outline: none;
          width: 100%;
        }
        .pf-input:focus, .pf-select:focus { border-color: var(--amber); }
        .pf-btn-add {
          background: var(--amber);
          color: #14100A;
          border: none;
          border-radius: 8px;
          font-weight: 600;
          font-size: 14px;
          padding: 9px 16px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
        }
        .pf-btn-add:hover { filter: brightness(1.08); }
        .pf-btn-ghost {
          background: transparent;
          border: 1px solid var(--line);
          color: var(--muted);
          border-radius: 8px;
          padding: 8px 12px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          font-size: 13px;
        }
        .pf-btn-ghost:hover { color: var(--text); border-color: var(--muted); }
        .pf-exchange-dot {
          width: 8px; height: 8px; border-radius: 999px; display: inline-block;
        }
        .pf-row:hover { background: var(--surface-hi); }
        .pf-trash { color: var(--muted); cursor: pointer; }
        .pf-trash:hover { color: var(--coral); }
        .pf-focus:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }
      `}</style>

      {/* Ticker tape - signature element */}
      <div className="pf-ticker-wrap">
        {tickerItems.length > 0 ? (
          <div className="pf-ticker-track">
            {[...tickerItems, ...tickerItems].map((h, i) => (
              <span className="pf-ticker-item pf-mono" key={i}>
                <span style={{ color: "var(--muted)" }}>{h.symbol}</span>
                <span>{fmtUSD(h.currentPrice)}</span>
                <span style={{ color: h.change24h >= 0 ? "var(--teal)" : "var(--coral)" }}>
                  {fmtPct(h.change24h)}
                </span>
              </span>
            ))}
          </div>
        ) : (
          <div style={{ padding: "0 20px", fontSize: 13, color: "var(--muted)" }} className="pf-mono">
            Coin ekledikçe burada canlı fiyat şeridi akacak
          </div>
        )}
      </div>

      {/* Hero total */}
      <div className="pf-hero">
        <div className="pf-hero-label">Toplam Portföy Değeri</div>
        <div className="pf-hero-value pf-mono">{fmtUSD(totalValue)}</div>
        <div style={{ marginTop: 8, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          {holdings.length > 0 && (
            <span
              className="pf-mono"
              style={{
                fontSize: 14,
                color: totalChange24 >= 0 ? "var(--teal)" : "var(--coral)",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              {totalChange24 >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
              {fmtPct(totalChange24)} bugün
            </span>
          )}
          {totalPnl != null && (
            <span
              className="pf-mono"
              style={{ fontSize: 14, color: totalPnl >= 0 ? "var(--teal)" : "var(--coral)" }}
            >
              {totalPnl >= 0 ? "▲" : "▼"} {fmtUSD(Math.abs(totalPnl))} ({fmtPct(totalPnlPct)}) toplam kâr/zarar
            </span>
          )}
          <button className="pf-btn-ghost pf-focus" onClick={fetchPrices} disabled={loading}>
            <RefreshCw size={13} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
            {loading ? "Güncelleniyor" : "Fiyatları yenile"}
          </button>
          <button className="pf-btn-ghost pf-focus" onClick={() => setShowSettings((s) => !s)}>
            <Settings size={13} />
            {apiKey ? "API anahtarı bağlı" : "API anahtarı ekle"}
          </button>
        </div>
        {priceError && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--coral)" }}>{priceError}</div>
        )}
        {showSettings && (
          <div
            className="pf-card"
            style={{ padding: 16, marginTop: 12, maxWidth: 460 }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <Key size={14} /> CoinGecko API Anahtarı (opsiyonel ama önerilir)
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
              Anahtarsız erişim çok hızlı hız limitine takılıyor. coingecko.com/en/api/pricing
              adresinden ücretsiz "Demo Plan" hesabı açıp Developer Dashboard'dan bir anahtar
              oluşturursan (kredi kartı istemiyor), limit dakikada 100 isteğe çıkıyor.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="pf-input pf-focus pf-mono"
                placeholder="CG-xxxxxxxxxxxxxxxxxxxx"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
              />
              <button className="pf-btn-add pf-focus" onClick={saveApiKey} style={{ whiteSpace: "nowrap" }}>
                Kaydet
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: 24, display: "grid", gap: 20 }}>
        {/* Coin search — which exchanges list it */}
        <div className="pf-card" style={{ padding: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: "var(--muted)" }}>
            COİN ARA — HANGİ BORSADA?
          </div>
          <input
            className="pf-input pf-focus"
            placeholder="Coin adı, sembolü veya sözleşme adresi (0x… / Solana) yaz"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (selectedSearchCoin) {
                setSelectedSearchCoin(null);
                setTickers([]);
                setTickersError(null);
              }
            }}
          />
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
            İsimle ara (örn. Pepe) ya da bir sözleşme adresi yapıştır — Ethereum, BSC, Polygon, Arbitrum, Optimism, Base, Avalanche, Fantom, Solana ve TON taranır.
          </div>
          {searchNotice && (
            <div style={{ fontSize: 12, color: "var(--coral)", marginTop: 8 }}>{searchNotice}</div>
          )}
          {searchLoading && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Aranıyor…</div>
          )}
          {!searchLoading && searchResults.length > 0 && !selectedSearchCoin && (
            <div style={{ marginTop: 10, display: "grid", gap: 4 }}>
              {searchResults.map((c) => (
                <div
                  key={c.id}
                  className="pf-row pf-focus"
                  tabIndex={0}
                  onClick={() => loadTickers(c)}
                  onKeyDown={(e) => e.key === "Enter" && loadTickers(c)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  {c.thumb && (
                    <img src={c.thumb} alt="" width={18} height={18} style={{ borderRadius: 4 }} />
                  )}
                  <span style={{ fontWeight: 600 }}>{c.symbol?.toUpperCase()}</span>
                  <span style={{ color: "var(--muted)" }}>{c.name}</span>
                  {c.contractPlatform && (
                    <span
                      className="pf-mono"
                      style={{
                        fontSize: 10,
                        color: "var(--muted)",
                        border: "1px solid var(--line)",
                        borderRadius: 999,
                        padding: "1px 6px",
                      }}
                    >
                      {c.contractPlatform}
                    </span>
                  )}
                  {c.market_cap_rank && (
                    <span className="pf-mono" style={{ marginLeft: "auto", color: "var(--muted)" }}>
                      #{c.market_cap_rank}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {selectedSearchCoin && (
            <div style={{ marginTop: 14 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 10,
                  fontSize: 13,
                }}
              >
                <span style={{ fontWeight: 600 }}>
                  {selectedSearchCoin.symbol?.toUpperCase()} — {selectedSearchCoin.name}
                </span>
                <button
                  className="pf-btn-ghost pf-focus"
                  style={{ marginLeft: "auto", padding: "4px 10px" }}
                  onClick={() => {
                    setSelectedSearchCoin(null);
                    setTickers([]);
                    setSearchQuery("");
                  }}
                >
                  Başka coin ara
                </button>
              </div>

              {tickersLoading && (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Borsalar taranıyor…</div>
              )}
              {tickersError && (
                <div style={{ fontSize: 12, color: "var(--coral)" }}>{tickersError}</div>
              )}
              {!tickersLoading && !tickersError && tickers.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Bu coin için borsa verisi bulunamadı.</div>
              )}
              {tickers.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--line)" }}>
                        <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--muted)", fontWeight: 500 }}>Borsa</th>
                        <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--muted)", fontWeight: 500 }}>Çift</th>
                        <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--muted)", fontWeight: 500 }}>Fiyat</th>
                        <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--muted)", fontWeight: 500 }}>24s Hacim</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {tickers.map((t, i) => (
                        <tr className="pf-row" key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                          <td style={{ padding: "8px", display: "flex", alignItems: "center", gap: 8 }}>
                            <span
                              className="pf-exchange-dot"
                              style={{ background: colorForExchange(t.market.name) }}
                            />
                            {t.market.name}
                          </td>
                          <td className="pf-mono" style={{ padding: "8px", color: "var(--muted)" }}>
                            {t.base}/{t.target}
                          </td>
                          <td className="pf-mono" style={{ padding: "8px" }}>
                            {t.last != null ? fmtUSD(t.converted_last?.usd ?? t.last) : "—"}
                          </td>
                          <td className="pf-mono" style={{ padding: "8px", color: "var(--muted)" }}>
                            {t.converted_volume?.usd ? fmtUSD(t.converted_volume.usd) : "—"}
                          </td>
                          <td style={{ padding: "8px", textAlign: "right" }}>
                            <button
                              className="pf-btn-ghost pf-focus"
                              style={{ padding: "4px 10px", fontSize: 12 }}
                              onClick={() => addFromSearch(selectedSearchCoin, t.market.name)}
                            >
                              Forma aktar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Add form */}
        <div className="pf-card" style={{ padding: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: "var(--muted)" }}>
            COİN EKLE
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr 1fr auto",
              gap: 10,
            }}
            className="pf-form-grid"
          >
            <select
              className="pf-select pf-focus"
              value={form.exchange}
              onChange={(e) => setForm((f) => ({ ...f, exchange: e.target.value }))}
            >
              {EXCHANGES.map((ex) => (
                <option key={ex} value={ex}>
                  {ex}
                </option>
              ))}
              <option value={CUSTOM_EXCHANGE}>+ Özel borsa yaz…</option>
            </select>
            {form.exchange === CUSTOM_EXCHANGE && (
              <input
                className="pf-input pf-focus"
                placeholder="Borsa adı (örn. Gate.io)"
                value={form.customExchange}
                onChange={(e) => setForm((f) => ({ ...f, customExchange: e.target.value }))}
              />
            )}
            <select
              className="pf-select pf-focus"
              value={form.coinId}
              onChange={(e) => setForm((f) => ({ ...f, coinId: e.target.value }))}
            >
              {allCoins.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.symbol} — {c.name}
                </option>
              ))}
            </select>
            <input
              className="pf-input pf-focus pf-mono"
              placeholder="Miktar"
              type="number"
              min="0"
              step="any"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
            <input
              className="pf-input pf-focus pf-mono"
              placeholder="Alış fiyatı $ (opsiyonel)"
              type="number"
              min="0"
              step="any"
              value={form.buyPrice}
              onChange={(e) => setForm((f) => ({ ...f, buyPrice: e.target.value }))}
            />
            <button className="pf-btn-add pf-focus" onClick={addHolding}>
              <Plus size={16} /> Ekle
            </button>
          </div>
        </div>

        {holdings.length === 0 ? (
          <div
            className="pf-card"
            style={{ padding: 48, textAlign: "center", color: "var(--muted)" }}
          >
            <Wallet size={28} style={{ marginBottom: 10, opacity: 0.6 }} />
            <div className="pf-display" style={{ fontSize: 18, color: "var(--text)", marginBottom: 4 }}>
              Henüz coin eklemedin
            </div>
            <div style={{ fontSize: 13 }}>Yukarıdan borsa ve coin seçip ilk kaydını ekle.</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }} className="pf-main-grid">
            {/* Holdings by exchange */}
            <div style={{ display: "grid", gap: 16 }}>
              {Object.entries(byExchange).map(([ex, items]) => {
                const exTotal = items.reduce((s, h) => s + (h.value || 0), 0);
                return (
                  <div className="pf-card" key={ex} style={{ overflow: "hidden" }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "12px 16px",
                        borderBottom: "1px solid var(--line)",
                        background: "var(--surface-hi)",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 13 }}>
                        <span
                          className="pf-exchange-dot"
                          style={{ background: colorForExchange(ex) }}
                        />
                        {ex.toUpperCase()}
                      </span>
                      <span className="pf-mono" style={{ fontSize: 13, color: "var(--muted)" }}>
                        {fmtUSD(exTotal)}
                      </span>
                    </div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <tbody>
                        {items.map((h) => (
                          <tr className="pf-row" key={h.rid} style={{ borderBottom: "1px solid var(--line)" }}>
                            <td style={{ padding: "10px 16px", fontWeight: 600 }}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                {h.symbol}
                                {signals[h.coinId] && (
                                  <span
                                    className="pf-mono"
                                    title={signals[h.coinId].reasons?.join(" · ")}
                                    style={{
                                      fontSize: 10,
                                      fontWeight: 700,
                                      color: SIGNAL_COLORS[signals[h.coinId].suggestion],
                                      border: `1px solid ${SIGNAL_COLORS[signals[h.coinId].suggestion]}`,
                                      borderRadius: 4,
                                      padding: "1px 5px",
                                    }}
                                  >
                                    {signals[h.coinId].suggestion}
                                  </span>
                                )}
                              </span>
                            </td>
                            <td style={{ padding: "10px 8px", color: "var(--muted)" }} className="pf-mono">
                              {h.amount}
                            </td>
                            <td style={{ padding: "10px 8px" }} className="pf-mono">
                              {h.currentPrice != null ? fmtUSD(h.currentPrice) : "…"}
                            </td>
                            <td
                              style={{
                                padding: "10px 8px",
                                color: h.change24h >= 0 ? "var(--teal)" : "var(--coral)",
                              }}
                              className="pf-mono"
                            >
                              {h.change24h != null ? fmtPct(h.change24h) : "—"}
                            </td>
                            <td style={{ padding: "10px 8px", fontWeight: 600 }} className="pf-mono">
                              {h.value != null ? fmtUSD(h.value) : "…"}
                            </td>
                            <td
                              style={{
                                padding: "10px 8px",
                                color: h.pnl == null ? "var(--muted)" : h.pnl >= 0 ? "var(--teal)" : "var(--coral)",
                              }}
                              className="pf-mono"
                            >
                              {h.pnl != null ? `${fmtUSD(h.pnl)} (${fmtPct(h.pnlPct)})` : "—"}
                            </td>
                            <td style={{ padding: "10px 16px", textAlign: "right" }}>
                              <Trash2
                                size={15}
                                className="pf-trash"
                                onClick={() => removeHolding(h.rid)}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>

            {/* Allocation pie */}
            <div className="pf-card" style={{ padding: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--muted)" }}>
                BORSAYA GÖRE DAĞILIM
              </div>
              {pieData.length > 0 ? (
                <div style={{ width: "100%", height: 220 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={55}
                        outerRadius={85}
                        paddingAngle={2}
                      >
                        {pieData.map((d, i) => (
                          <Cell key={i} fill={colorForExchange(d.name)} stroke="var(--surface)" />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v) => fmtUSD(v)}
                        contentStyle={{
                          background: "var(--surface-hi)",
                          border: "1px solid var(--line)",
                          borderRadius: 8,
                          color: "var(--text)",
                          fontSize: 12,
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "var(--muted)" }}>Fiyatlar geldiğinde grafik görünecek.</div>
              )}
              <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                {pieData.map((d) => (
                  <div key={d.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        className="pf-exchange-dot"
                        style={{ background: colorForExchange(d.name) }}
                      />
                      {d.name}
                    </span>
                    <span className="pf-mono" style={{ color: "var(--muted)" }}>
                      {totalValue > 0 ? ((d.value / totalValue) * 100).toFixed(1) : "0"}%
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* 7-day value history */}
            <div className="pf-card" style={{ padding: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--muted)" }}>
                SON 7 GÜN
              </div>
              {historyChartData.length >= 2 ? (
                <>
                  <div style={{ width: "100%", height: 160 }}>
                    <ResponsiveContainer>
                      <LineChart data={historyChartData}>
                        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                        <XAxis
                          dataKey="label"
                          stroke="var(--muted)"
                          fontSize={11}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis hide domain={["auto", "auto"]} />
                        <Tooltip
                          formatter={(v) => fmtUSD(v)}
                          labelFormatter={(_, payload) => payload?.[0]?.payload?.date || ""}
                          contentStyle={{
                            background: "var(--surface-hi)",
                            border: "1px solid var(--line)",
                            borderRadius: 8,
                            color: "var(--text)",
                            fontSize: 12,
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="value"
                          stroke="var(--amber)"
                          strokeWidth={2}
                          dot={{ r: 3, fill: "var(--amber)" }}
                          activeDot={{ r: 5 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  {weeklyChange && (
                    <div
                      className="pf-mono"
                      style={{
                        marginTop: 6,
                        fontSize: 13,
                        color: weeklyChange.diff >= 0 ? "var(--teal)" : "var(--coral)",
                      }}
                    >
                      {weeklyChange.diff >= 0 ? "▲" : "▼"} {fmtUSD(Math.abs(weeklyChange.diff))} (
                      {fmtPct(weeklyChange.pct)}) bu hafta
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 13, color: "var(--muted)" }}>
                  Birkaç gün daha kullandıkça burada haftalık değer grafiğin oluşacak.
                </div>
              )}
            </div>

            {/* Daily buy/sell suggestions — technical, not financial advice */}
            <div className="pf-card" style={{ padding: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: "var(--muted)" }}>
                BUGÜNÜN ÖNERİLERİ {signalsLoading && "(hesaplanıyor…)"}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
                RSI, hareketli ortalama ve fiyat trendine dayanan otomatik, mekanik bir hesaplama.
                Yatırım tavsiyesi değildir; piyasa riski her zaman vardır.
              </div>
              {Object.keys(byExchange).length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--muted)" }}>
                  Coin ekleyince burada günlük öneriler görünecek.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {[...new Set(holdings.map((h) => h.coinId))].map((coinId) => {
                    const h = holdings.find((x) => x.coinId === coinId);
                    const sig = signals[coinId];
                    return (
                      <div
                        key={coinId}
                        style={{
                          borderTop: "1px solid var(--line)",
                          paddingTop: 10,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{h?.symbol}</span>
                          {sig ? (
                            <span
                              className="pf-mono"
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                color: SIGNAL_COLORS[sig.suggestion],
                                border: `1px solid ${SIGNAL_COLORS[sig.suggestion]}`,
                                borderRadius: 4,
                                padding: "1px 6px",
                              }}
                            >
                              {sig.suggestion}
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, color: "var(--muted)" }}>hesaplanıyor…</span>
                          )}
                        </div>
                        {sig && (
                          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "var(--muted)" }}>
                            {sig.reasons.map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>


      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 720px) {
          .pf-form-grid { grid-template-columns: 1fr 1fr !important; }
          .pf-main-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
