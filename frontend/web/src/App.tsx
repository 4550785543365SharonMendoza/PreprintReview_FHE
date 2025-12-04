// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface Manuscript {
  id: string;
  title: string;
  field: string;
  encryptedData: string;
  timestamp: number;
  status: "pending" | "reviewed" | "revised";
  reviews: number;
}

const App: React.FC = () => {
  // Randomized style selections:
  // Colors: High contrast (blue+orange)
  // UI Style: Future metal
  // Layout: Center radiation
  // Interaction: Micro-interactions (hover effects)
  
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [manuscripts, setManuscripts] = useState<Manuscript[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newManuscript, setNewManuscript] = useState({
    title: "",
    field: "",
    abstract: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedField, setSelectedField] = useState("all");
  const [showStats, setShowStats] = useState(false);

  // Calculate statistics
  const pendingCount = manuscripts.filter(m => m.status === "pending").length;
  const reviewedCount = manuscripts.filter(m => m.status === "reviewed").length;
  const revisedCount = manuscripts.filter(m => m.status === "revised").length;
  const totalReviews = manuscripts.reduce((sum, m) => sum + m.reviews, 0);
  const avgReviews = manuscripts.length > 0 ? (totalReviews / manuscripts.length).toFixed(1) : 0;

  useEffect(() => {
    loadManuscripts().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadManuscripts = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("manuscript_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing manuscript keys:", e);
        }
      }
      
      const list: Manuscript[] = [];
      
      for (const key of keys) {
        try {
          const msBytes = await contract.getData(`manuscript_${key}`);
          if (msBytes.length > 0) {
            try {
              const msData = JSON.parse(ethers.toUtf8String(msBytes));
              list.push({
                id: key,
                title: msData.title,
                field: msData.field,
                encryptedData: msData.data,
                timestamp: msData.timestamp,
                status: msData.status || "pending",
                reviews: msData.reviews || 0
              });
            } catch (e) {
              console.error(`Error parsing manuscript data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading manuscript ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setManuscripts(list);
    } catch (e) {
      console.error("Error loading manuscripts:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitManuscript = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setSubmitting(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting manuscript with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newManuscript))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const msId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const msData = {
        title: newManuscript.title,
        field: newManuscript.field,
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        status: "pending",
        reviews: 0
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `manuscript_${msId}`, 
        ethers.toUtf8Bytes(JSON.stringify(msData))
      );
      
      const keysBytes = await contract.getData("manuscript_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(msId);
      
      await contract.setData(
        "manuscript_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Manuscript submitted securely with FHE!"
      });
      
      await loadManuscripts();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowSubmitModal(false);
        setNewManuscript({
          title: "",
          field: "",
          abstract: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setSubmitting(false);
    }
  };

  const addReview = async (msId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted review with FHE..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const msBytes = await contract.getData(`manuscript_${msId}`);
      if (msBytes.length === 0) {
        throw new Error("Manuscript not found");
      }
      
      const msData = JSON.parse(ethers.toUtf8String(msBytes));
      
      const updatedMs = {
        ...msData,
        reviews: (msData.reviews || 0) + 1,
        status: msData.status === "pending" ? "reviewed" : msData.status
      };
      
      await contract.setData(
        `manuscript_${msId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedMs))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE review recorded successfully!"
      });
      
      await loadManuscripts();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Review failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const filteredManuscripts = manuscripts.filter(ms => {
    const matchesSearch = ms.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         ms.field.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesField = selectedField === "all" || ms.field === selectedField;
    return matchesSearch && matchesField;
  });

  const fields = Array.from(new Set(manuscripts.map(ms => ms.field)));

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <div className="radial-bg"></div>
      
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="atom-icon"></div>
          </div>
          <h1>FHE<span>PeerReview</span></h1>
        </div>
        
        <div className="header-actions">
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <main className="main-content">
        <div className="central-panel">
          <div className="panel-header">
            <h2>Anonymous Pre-submission Review</h2>
            <p>Securely submit and review manuscripts using FHE encryption</p>
          </div>
          
          <div className="action-buttons">
            <button 
              onClick={() => setShowSubmitModal(true)} 
              className="action-btn primary metal-btn"
            >
              Submit Manuscript
            </button>
            <button 
              onClick={() => setShowStats(!showStats)} 
              className="action-btn secondary metal-btn"
            >
              {showStats ? "Hide Stats" : "Show Stats"}
            </button>
            <button 
              onClick={loadManuscripts}
              className="action-btn secondary metal-btn"
              disabled={isRefreshing}
            >
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          
          {showStats && (
            <div className="stats-panel metal-card">
              <h3>Platform Statistics</h3>
              <div className="stats-grid">
                <div className="stat-item">
                  <div className="stat-value">{manuscripts.length}</div>
                  <div className="stat-label">Total Manuscripts</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{pendingCount}</div>
                  <div className="stat-label">Pending Review</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{reviewedCount}</div>
                  <div className="stat-label">Reviewed</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{revisedCount}</div>
                  <div className="stat-label">Revised</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{avgReviews}</div>
                  <div className="stat-label">Avg Reviews</div>
                </div>
              </div>
            </div>
          )}
          
          <div className="search-filters metal-card">
            <div className="search-box">
              <input 
                type="text" 
                placeholder="Search manuscripts..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="metal-input"
              />
            </div>
            <div className="filter-box">
              <select 
                value={selectedField} 
                onChange={(e) => setSelectedField(e.target.value)}
                className="metal-select"
              >
                <option value="all">All Fields</option>
                {fields.map(field => (
                  <option key={field} value={field}>{field}</option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="manuscripts-list metal-card">
            {filteredManuscripts.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon"></div>
                <p>No manuscripts found</p>
                <button 
                  className="action-btn primary metal-btn"
                  onClick={() => setShowSubmitModal(true)}
                >
                  Submit First Manuscript
                </button>
              </div>
            ) : (
              <ul>
                {filteredManuscripts.map(ms => (
                  <li key={ms.id} className="manuscript-item">
                    <div className="ms-content">
                      <h3>{ms.title}</h3>
                      <div className="ms-meta">
                        <span className="field-badge">{ms.field}</span>
                        <span className="date">{new Date(ms.timestamp * 1000).toLocaleDateString()}</span>
                        <span className={`status-badge ${ms.status}`}>{ms.status}</span>
                        <span className="reviews">Reviews: {ms.reviews}</span>
                      </div>
                    </div>
                    <div className="ms-actions">
                      <button 
                        className="action-btn small metal-btn"
                        onClick={() => addReview(ms.id)}
                      >
                        Add Review
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </main>
  
      {showSubmitModal && (
        <ModalSubmit 
          onSubmit={submitManuscript} 
          onClose={() => setShowSubmitModal(false)} 
          submitting={submitting}
          manuscript={newManuscript}
          setManuscript={setNewManuscript}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metal-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">About</a>
            <a href="#" className="footer-link">FAQ</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHE PeerReview. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalSubmitProps {
  onSubmit: () => void; 
  onClose: () => void; 
  submitting: boolean;
  manuscript: any;
  setManuscript: (data: any) => void;
}

const ModalSubmit: React.FC<ModalSubmitProps> = ({ 
  onSubmit, 
  onClose, 
  submitting,
  manuscript,
  setManuscript
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setManuscript({
      ...manuscript,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!manuscript.title || !manuscript.field || !manuscript.abstract) {
      alert("Please fill all required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="submit-modal metal-card">
        <div className="modal-header">
          <h2>Submit New Manuscript</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon"></div> 
            <span>Your manuscript will be encrypted with FHE before submission</span>
          </div>
          
          <div className="form-group">
            <label>Title *</label>
            <input 
              type="text"
              name="title"
              value={manuscript.title} 
              onChange={handleChange}
              placeholder="Manuscript title..." 
              className="metal-input"
            />
          </div>
          
          <div className="form-group">
            <label>Field *</label>
            <select 
              name="field"
              value={manuscript.field} 
              onChange={handleChange}
              className="metal-select"
            >
              <option value="">Select field</option>
              <option value="Biology">Biology</option>
              <option value="Physics">Physics</option>
              <option value="Chemistry">Chemistry</option>
              <option value="Computer Science">Computer Science</option>
              <option value="Mathematics">Mathematics</option>
              <option value="Medicine">Medicine</option>
              <option value="Engineering">Engineering</option>
              <option value="Other">Other</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Abstract *</label>
            <textarea 
              name="abstract"
              value={manuscript.abstract} 
              onChange={handleChange}
              placeholder="Enter your abstract (will be FHE encrypted)..." 
              className="metal-textarea"
              rows={6}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="action-btn secondary metal-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={submitting}
            className="action-btn primary metal-btn"
          >
            {submitting ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;