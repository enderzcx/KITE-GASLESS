import { useState } from 'react';

function LoginPage({ onLogin }) {
  const [showToast, setShowToast] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    try {
      setLoading(true);
      setError('');
      await onLogin();
      setShowToast(true);
      setTimeout(() => {
        setShowToast(false);
      }, 1400);
    } catch (err) {
      setError(err.message || 'Failed to connect wallet');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      {showToast && (
        <div className="login-toast">Your dedicated KITE BOT is ready!</div>
      )}
      <button className="login-btn" onClick={handleLogin} disabled={loading}>
        {loading ? 'Connecting wallet...' : 'Claim Your KITE BOT'}
      </button>
      {error && <div className="request-error">{error}</div>}
    </div>
  );
}

export default LoginPage;

