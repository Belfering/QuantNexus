import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';

export default function DataManagement() {
  const [ticker, setTicker] = useState('');
  const [downloads, setDownloads] = useState<any[]>([]);
  const [availableTickers, setAvailableTickers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const [downloadsData, tickersData] = await Promise.all([
        api.data.getDownloads(),
        api.data.getTickers(),
      ]);
      setDownloads(downloadsData);
      setAvailableTickers(tickersData.tickers || []);
    } catch (error) {
      console.error('Error loading data:', error);
    }
  };

  const handleDownload = async () => {
    if (!ticker.trim()) return;
    setLoading(true);
    try {
      await api.data.download(ticker.toUpperCase());
      setTicker('');
      loadData();
    } catch (error) {
      console.error('Error downloading:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Data Management</h2>
        <p className="text-muted-foreground">Download and manage market data from yfinance.</p>
      </div>

      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Download Ticker Data</h3>
        <div className="flex gap-2">
          <Input placeholder="Enter ticker symbol (e.g., SPY, QQQ)" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && handleDownload()} className="flex-1" />
          <Button onClick={handleDownload} disabled={loading || !ticker.trim()}>{loading ? 'Downloading...' : 'Download'}</Button>
        </div>
        <p className="text-sm text-muted-foreground mt-2">Downloads last 10 years of historical data</p>
      </Card>

      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Available Tickers ({availableTickers.length})</h3>
        {availableTickers.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {availableTickers.map((t) => (
              <span key={t} className="px-3 py-1 bg-secondary text-secondary-foreground rounded-md text-sm">{t}</span>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">No data downloaded yet</p>
        )}
      </Card>

      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Recent Downloads</h3>
        {downloads.length > 0 ? (
          <div className="space-y-2">
            {downloads.slice(0, 10).map((job) => (
              <div key={job.id} className="flex items-center justify-between p-3 bg-secondary rounded-md">
                <div>
                  <span className="font-medium">{job.ticker}</span>
                  <span className="text-sm text-muted-foreground ml-2">{new Date(job.createdAt).toLocaleString()}</span>
                </div>
                <span className={`text-sm px-2 py-1 rounded ${job.status === 'completed' ? 'bg-green-100 text-green-800' : job.status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>{job.status}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">No downloads yet</p>
        )}
      </Card>
    </div>
  );
}
