/**
 * API client for Atlas Forge
 */

const API_BASE = '/api';

export const api = {
  // Data Management
  data: {
    async download(ticker: string, startDate?: string, endDate?: string) {
      const res = await fetch(`${API_BASE}/data/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, startDate, endDate }),
      });
      return res.json();
    },

    async getDownloads() {
      const res = await fetch(`${API_BASE}/data/downloads`);
      return res.json();
    },

    async getTickers() {
      const res = await fetch(`${API_BASE}/data/tickers`);
      return res.json();
    },

    async getTickerLists() {
      const res = await fetch(`${API_BASE}/data/ticker-lists`);
      return res.json();
    },

    async createTickerList(name: string, type: 'etf' | 'stock' | 'mixed', tickers: string[]) {
      const res = await fetch(`${API_BASE}/data/ticker-lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type, tickers }),
      });
      return res.json();
    },
  },

  // Forge
  forge: {
    async start(config: any) {
      const res = await fetch(`${API_BASE}/forge/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      return res.json();
    },

    async cancel(jobId: number) {
      const res = await fetch(`${API_BASE}/forge/cancel/${jobId}`, {
        method: 'POST',
      });
      return res.json();
    },

    async getStatus(jobId: number) {
      const res = await fetch(`${API_BASE}/forge/status/${jobId}`);
      return res.json();
    },

    createEventSource(jobId: number) {
      return new EventSource(`${API_BASE}/forge/stream/${jobId}`);
    },

    async estimate(config: any) {
      const res = await fetch(`${API_BASE}/forge/estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      return res.json();
    },

    async getConfigs() {
      const res = await fetch(`${API_BASE}/forge/configs`);
      return res.json();
    },

    async saveConfig(name: string, config: any) {
      const res = await fetch(`${API_BASE}/forge/configs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, config }),
      });
      return res.json();
    },
  },

  // Results
  results: {
    async getResults(jobId: number, sortBy?: string, order?: 'asc' | 'desc', limit?: number) {
      const params = new URLSearchParams();
      if (sortBy) params.append('sortBy', sortBy);
      if (order) params.append('order', order);
      if (limit) params.append('limit', limit.toString());

      const res = await fetch(`${API_BASE}/results/${jobId}?${params}`);
      return res.json();
    },

    async downloadCSV(jobId: number) {
      const res = await fetch(`${API_BASE}/results/${jobId}/csv`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `results_job${jobId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    },
  },
};
