import { useEffect, useState } from "react";
import { db, auth } from "../firebase";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot, doc, getDoc, updateDoc, arrayUnion, query, orderBy } from "firebase/firestore";
import { motion, AnimatePresence } from "framer-motion";

function Requests() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("active"); // "active" | "history"
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [currentUserProfile, setCurrentUserProfile] = useState(null);
  
  // Cache fetched user profiles by UID to avoid redundant Firestore reads
  const [userProfilesCache, setUserProfilesCache] = useState({});

  // Resolution Evaluation Modal States
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [rating, setRating] = useState(5);
  const [evaluationNote, setEvaluationNote] = useState("");

  // Helper: Format elapsed time relative to current date
  const getTimeElapsed = (timestamp) => {
    if (!timestamp) return "Just now";
    const created = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(created.getTime())) return "Just now";

    const now = new Date();
    const diffMs = Math.abs(now - created);
    
    const minutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return "Just now";
  };

  // Helper for formatting roles
  const formatRole = (role) => {
    if (role === "admin assistant" || role === "admin_assistant") return "Admin Assistant";
    if (role === "admin") return "Admin";
    return role || "Support";
  };

  // 1. Helper: Fetch profile photo using all common key fallbacks + cached user doc
  const getUserAvatar = (ticket) => {
    if (!ticket) return null;
    const uid = ticket.userId || ticket.studentId || ticket.createdBy || ticket.uid;
    const cachedUser = userProfilesCache[uid];

    return (
      ticket.userPhoto || 
      ticket.photoURL || 
      ticket.profilePic || 
      ticket.profilePicture || 
      ticket.userAvatar || 
      ticket.avatar || 
      cachedUser?.profilePicture || 
      cachedUser?.photoURL || 
      cachedUser?.avatar || 
      null
    );
  };

  // 2. Helper: Fetch display name using all common key fallbacks + cached user doc
  const getUserDisplayName = (ticket) => {
    if (!ticket) return "User";
    const uid = ticket.userId || ticket.studentId || ticket.createdBy || ticket.uid;
    const cachedUser = userProfilesCache[uid];

    return (
      ticket.userName || 
      ticket.displayName || 
      ticket.studentName || 
      ticket.fullname || 
      cachedUser?.fullname || 
      cachedUser?.displayName || 
      "User"
    );
  };

  // 3. Fetch logged in admin profile details
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const userDoc = await getDoc(doc(db, "users", user.uid));
          if (userDoc.exists()) {
            setCurrentUserProfile(userDoc.data());
          } else {
            setCurrentUserProfile({
              fullname: user.displayName || "Admin Support",
              role: "admin",
              photoURL: user.photoURL || null
            });
          }
        } catch (err) {
          console.error("Error fetching admin profile:", err);
        }
      }
    });

    return () => unsubscribeAuth();
  }, []);

  // 4. Listen to tickets in real-time and fetch student user profiles dynamically if missing
  useEffect(() => {
    const q = query(collection(db, "tickets"), orderBy("createdAt", "desc"));
    
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const docsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setTickets(docsData);
      
      // Update selected ticket in real-time if open
      setSelectedTicket(prevSelected => {
        if (!prevSelected) return null;
        return docsData.find(t => t.id === prevSelected.id) || prevSelected;
      });

      // Find any missing user profiles that need fetching from "users" collection
      const missingUids = docsData
        .map(t => t.userId || t.studentId || t.createdBy || t.uid)
        .filter(uid => uid && !userProfilesCache[uid]);

      if (missingUids.length > 0) {
        const uniqueUids = [...new Set(missingUids)];
        const newProfiles = {};

        for (const uid of uniqueUids) {
          try {
            const uSnap = await getDoc(doc(db, "users", uid));
            if (uSnap.exists()) {
              newProfiles[uid] = uSnap.data();
            }
          } catch (e) {
            console.error("Error loading user profile for", uid, e);
          }
        }

        if (Object.keys(newProfiles).length > 0) {
          setUserProfilesCache(prev => ({ ...prev, ...newProfiles }));
        }
      }

      setLoading(false);
    }, (error) => {
      console.error("Error fetching tickets:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [userProfilesCache]);

  // Transmit Reply
  const handleSendReply = async (e) => {
    e.preventDefault();
    if (!replyText.trim() || !selectedTicket || sending || selectedTicket.status === "resolved") return;

    setSending(true);
    try {
      const ticketDocRef = doc(db, "tickets", selectedTicket.id);
      const responderName = currentUserProfile?.fullname || auth.currentUser?.displayName || "Support Team";
      const responderRole = formatRole(currentUserProfile?.role);
      const responderPhoto = currentUserProfile?.photoURL || auth.currentUser?.photoURL || null;
      
      const newReply = {
        senderId: auth.currentUser?.uid || "admin",
        senderName: `${responderName} (${responderRole})`,
        senderPhoto: responderPhoto,
        message: replyText.trim(),
        timestamp: new Date().toISOString(),
        isAdmin: true
      };

      await updateDoc(ticketDocRef, {
        messages: arrayUnion(newReply),
        status: "replied", 
        lastUpdatedAt: new Date().toISOString()
      });

      setReplyText("");
    } catch (error) {
      console.error("Error transmitting response:", error);
    } finally {
      setSending(false);
    }
  };

  // Close ticket with evaluation
  const handleConfirmCloseTicket = async (e) => {
    e.preventDefault();
    if (!selectedTicket) return;

    try {
      const ticketDocRef = doc(db, "tickets", selectedTicket.id);
      const resolverName = currentUserProfile?.fullname || auth.currentUser?.displayName || "Support Team";
      const resolverRole = formatRole(currentUserProfile?.role);
      const resolverPhoto = currentUserProfile?.photoURL || auth.currentUser?.photoURL || null;

      await updateDoc(ticketDocRef, {
        status: "resolved",
        evaluation: {
          rating: rating,
          note: evaluationNote.trim() || "Resolved by support.",
          resolvedBy: `${resolverName} (${resolverRole})`,
          resolvedByPhoto: resolverPhoto,
          resolvedById: auth.currentUser?.uid || null,
          closedAt: new Date().toISOString()
        },
        lastUpdatedAt: new Date().toISOString()
      });

      setShowCloseModal(false);
      setEvaluationNote("");
      setRating(5);
    } catch (error) {
      console.error("Error closing ticket:", error);
    }
  };

  const activeTickets = tickets.filter(t => t.status !== "resolved");
  const resolvedTickets = tickets.filter(t => t.status === "resolved");
  const displayedTickets = activeTab === "active" ? activeTickets : resolvedTickets;

  if (loading) {
    return (
      <div className="container py-5 text-center" style={{ marginTop: "80px" }}>
        <div className="spinner-border text-primary" role="status"></div>
        <p className="text-muted mt-3">Loading tickets desk...</p>
      </div>
    );
  }

  return (
    <div className="bg-light min-vh-100 py-5" style={{ marginTop: "20px" }}>
      <div className="container">
        <div className="row justify-content-center">
          <div className="col-lg-10">
            
            {/* Header & Tabs */}
            <div className="d-flex align-items-center justify-content-between mb-4 flex-wrap gap-3">
              <div>
                <h3 className="fw-bold text-dark mb-1">Support Tickets Desk</h3>
                <p className="text-muted small mb-0">Review requests, reply to users, and manage history.</p>
              </div>

              {/* Navigation Tabs */}
              <div className="btn-group bg-white p-1 rounded-pill shadow-sm">
                <button 
                  className={`btn btn-sm rounded-pill fw-semibold px-3 ${activeTab === "active" ? "btn-primary" : "btn-light text-muted"}`}
                  onClick={() => setActiveTab("active")}
                >
                  Active ({activeTickets.length})
                </button>
                <button 
                  className={`btn btn-sm rounded-pill fw-semibold px-3 ${activeTab === "history" ? "btn-primary" : "btn-light text-muted"}`}
                  onClick={() => setActiveTab("history")}
                >
                  Resolved History ({resolvedTickets.length})
                </button>
              </div>
            </div>

            {/* TICKET CARD LIST */}
            {displayedTickets.length === 0 ? (
              <div className="card border-0 shadow-sm rounded-4 p-5 text-center bg-white">
                <span className="fs-1">📂</span>
                <h5 className="fw-bold mt-3">No Tickets Found</h5>
                <p className="text-muted mb-0 small">
                  {activeTab === "active" ? "There are currently no open support tickets." : "No resolved tickets stored in history yet."}
                </p>
              </div>
            ) : (
              <div className="row g-3">
                {displayedTickets.map((ticket) => {
                  const userAvatar = getUserAvatar(ticket);
                  const userName = getUserDisplayName(ticket);

                  return (
                    <div className="col-12" key={ticket.id}>
                      <motion.div 
                        className="card border-0 shadow-sm rounded-4 bg-white p-4 hover-shadow"
                        style={{ cursor: "pointer" }}
                        whileHover={{ scale: 1.005 }}
                        onClick={() => setSelectedTicket(ticket)}
                      >
                        <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                          
                          {/* USER PROFILE AVATAR & NAME (MATCHING VIEWCLASS STYLE) */}
                          <div className="d-flex align-items-center gap-3">
                            {userAvatar ? (
                              <img 
                                src={userAvatar} 
                                alt={userName} 
                                className="rounded-circle border shadow-sm"
                                style={{ width: "48px", height: "48px", objectFit: "cover" }}
                              />
                            ) : (
                              <div 
                                className="bg-primary text-white rounded-circle d-flex align-items-center justify-content-center fw-bold shadow-sm" 
                                style={{ width: "48px", height: "48px", fontSize: "1.2rem" }}
                              >
                                {userName.charAt(0).toUpperCase()}
                              </div>
                            )}

                            <div>
                              <div className="d-flex align-items-center gap-2">
                                <h6 className="fw-bold mb-0 text-dark">{ticket.subject || "No Subject"}</h6>
                                <span className="badge bg-light text-muted border small" style={{ fontSize: "0.65rem" }}>
                                  ⏱️ {getTimeElapsed(ticket.createdAt)}
                                </span>
                              </div>

                              <div className="d-flex align-items-center gap-1 mt-0.5">
                                <span className="text-primary fw-bold small">{userName}</span>
                                {ticket.userEmail && <span className="text-muted small">({ticket.userEmail})</span>}
                              </div>
                            </div>
                          </div>

                          <div className="text-end d-flex align-items-center gap-3">
                            <span className={`badge rounded-pill px-3 py-1.5 small fw-bold ${
                              ticket.status === "resolved" ? "bg-secondary text-white" :
                              ticket.status === "replied" ? "bg-light text-success border border-success" : "bg-danger text-white animate-pulse"
                            }`}>
                              {ticket.status === "resolved" ? "Resolved" : ticket.status || "Pending"}
                            </span>
                          </div>
                        </div>
                        
                        <div className="mt-3 bg-light p-2.5 rounded-3 border-start border-primary border-3">
                          <p className="text-secondary small mb-0 text-truncate">
                            <strong>Latest Message:</strong> {ticket.messages && ticket.messages.length > 0 ? ticket.messages[ticket.messages.length - 1].message : "No message logs."}
                          </p>
                        </div>

                        {ticket.status === "resolved" && ticket.evaluation && (
                          <div className="mt-3 pt-2 border-top d-flex align-items-center justify-content-between text-muted small flex-wrap gap-2">
                            <div className="d-flex align-items-center gap-2 flex-wrap">
                              <span><strong>Evaluation:</strong> {ticket.evaluation.note}</span>
                              {ticket.evaluation.resolvedBy && (
                                <span className="badge bg-light text-dark border d-inline-flex align-items-center gap-1 px-2 py-1 rounded-pill">
                                  {ticket.evaluation.resolvedByPhoto ? (
                                    <img 
                                      src={ticket.evaluation.resolvedByPhoto} 
                                      alt="Resolver" 
                                      className="rounded-circle object-fit-cover" 
                                      style={{ width: "16px", height: "16px" }} 
                                    />
                                  ) : (
                                    <span className="bg-secondary text-white rounded-circle d-inline-flex align-items-center justify-content-center" style={{ width: "16px", height: "16px", fontSize: "0.5rem" }}>✓</span>
                                  )}
                                  Resolved by: {ticket.evaluation.resolvedBy}
                                </span>
                              )}
                            </div>
                            <span className="text-warning fw-bold">{"★".repeat(ticket.evaluation.rating || 5)}</span>
                          </div>
                        )}
                      </motion.div>
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        </div>
      </div>

      {/* CHAT MODAL WITH USER PROFILE IN HEADER AND MESSAGES */}
      <AnimatePresence>
        {selectedTicket && (
          <motion.div 
            className="modal d-block" 
            style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 2050 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="modal-dialog modal-dialog-centered modal-lg">
              <motion.div 
                className="modal-content border-0 shadow-xl rounded-4 overflow-hidden bg-white"
                style={{ height: "620px", display: "flex", flexDirection: "column" }}
                initial={{ scale: 0.95, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.95, y: 20 }}
              >
                
                {/* MODAL HEADER: USER PROFILE DISPLAY */}
                <div className="p-4 bg-primary text-white d-flex justify-content-between align-items-center shadow-sm">
                  <div className="d-flex align-items-center gap-3">
                    {getUserAvatar(selectedTicket) ? (
                      <img 
                        src={getUserAvatar(selectedTicket)} 
                        alt={getUserDisplayName(selectedTicket)} 
                        className="rounded-circle border border-2 border-white shadow-sm"
                        style={{ width: "48px", height: "48px", objectFit: "cover" }}
                      />
                    ) : (
                      <div 
                        className="bg-white text-primary rounded-circle d-flex align-items-center justify-content-center fw-bold shadow-sm" 
                        style={{ width: "48px", height: "48px", fontSize: "1.2rem" }}
                      >
                        {getUserDisplayName(selectedTicket).charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <h5 className="fw-bold mb-0">{selectedTicket.subject || "Support Ticket"}</h5>
                      <span className="small text-white-50">{getUserDisplayName(selectedTicket)} • Open for: {getTimeElapsed(selectedTicket.createdAt)}</span>
                    </div>
                  </div>
                  
                  <div className="d-flex align-items-center gap-2">
                    {selectedTicket.status !== "resolved" && (
                      <button 
                        className="btn btn-sm btn-light text-danger fw-bold rounded-pill px-3 me-2"
                        onClick={() => setShowCloseModal(true)}
                      >
                        Close Ticket
                      </button>
                    )}
                    <button type="button" className="btn-close btn-close-white border-0" onClick={() => setSelectedTicket(null)} aria-label="Close"></button>
                  </div>
                </div>

                {/* RESOLVED BANNER */}
                {selectedTicket.status === "resolved" && (
                  <div className="bg-secondary text-white text-center py-2 small fw-bold d-flex align-items-center justify-content-center gap-2">
                    <span>This ticket has been marked as resolved</span>
                    {selectedTicket.evaluation?.resolvedBy && (
                      <span className="badge bg-white text-dark d-inline-flex align-items-center gap-1">
                        {selectedTicket.evaluation.resolvedByPhoto && (
                          <img 
                            src={selectedTicket.evaluation.resolvedByPhoto} 
                            alt="Resolver Avatar" 
                            className="rounded-circle object-fit-cover" 
                            style={{ width: "16px", height: "16px" }}
                          />
                        )}
                        by {selectedTicket.evaluation.resolvedBy}
                      </span>
                    )}
                  </div>
                )}

                {/* CHAT MESSAGES WITH PROFILE AVATARS */}
                <div className="p-4 flex-grow-1 bg-light overflow-auto d-flex flex-column gap-3" style={{ overflowY: "auto" }}>
                  {selectedTicket.messages?.map((msg, index) => {
                    const isAdminSender = msg.isAdmin || msg.senderId === auth.currentUser?.uid;
                    const avatarPhoto = isAdminSender 
                      ? (msg.senderPhoto || currentUserProfile?.photoURL || auth.currentUser?.photoURL)
                      : getUserAvatar(selectedTicket);

                    return (
                      <div 
                        key={index} 
                        className={`d-flex flex-column ${isAdminSender ? "align-items-end" : "align-items-start"}`}
                      >
                        <div 
                          className={`p-3 rounded-4 shadow-sm small ${
                            isAdminSender 
                              ? "bg-primary text-white rounded-bottom-end-0" 
                              : "bg-white text-dark rounded-bottom-start-0 border"
                          }`}
                          style={{ maxWidth: "75%" }}
                        >
                          <p className="mb-1 m-0 text-break">{msg.message}</p>
                          <div className={`text-end ${isAdminSender ? "text-white-50" : "text-muted"}`} style={{ fontSize: "0.65rem" }}>
                            {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ""}
                          </div>
                        </div>

                        {/* AVATAR + SENDER NAME BELOW BUBBLE */}
                        <div className={`d-flex align-items-center gap-1.5 mt-1 px-1 ${isAdminSender ? "flex-row-reverse" : "flex-row"}`}>
                          {avatarPhoto ? (
                            <img 
                              src={avatarPhoto} 
                              alt="Profile" 
                              className="rounded-circle object-fit-cover shadow-sm"
                              style={{ width: "22px", height: "22px" }}
                            />
                          ) : (
                            <div 
                              className="bg-secondary text-white rounded-circle d-flex align-items-center justify-content-center fw-bold" 
                              style={{ width: "22px", height: "22px", fontSize: "0.6rem" }}
                            >
                              {isAdminSender ? "A" : getUserDisplayName(selectedTicket).charAt(0).toUpperCase()}
                            </div>
                          )}

                          <span className="text-muted" style={{ fontSize: '0.65rem' }}>
                            {isAdminSender ? (msg.senderName || "Support") : getUserDisplayName(selectedTicket)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* REPLY INPUT */}
                <div className="p-3 bg-white border-top">
                  <form onSubmit={handleSendReply} className="d-flex gap-2">
                    <input 
                      type="text" 
                      className="form-control rounded-pill px-4 border" 
                      placeholder={selectedTicket.status === "resolved" ? "Ticket is resolved..." : `Reply to ${getUserDisplayName(selectedTicket)}...`}
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      disabled={sending || selectedTicket.status === "resolved"}
                    />
                    <button 
                      type="submit" 
                      disabled={!replyText.trim() || sending || selectedTicket.status === "resolved"} 
                      className="btn btn-primary px-4 rounded-pill fw-bold shadow-sm"
                    >
                      {sending ? "Sending..." : "Send"}
                    </button>
                  </form>
                </div>

              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* RESOLUTION MODAL */}
      <AnimatePresence>
        {showCloseModal && (
          <motion.div 
            className="modal d-block" 
            style={{ backgroundColor: "rgba(0,0,0,0.6)", zIndex: 2060 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="modal-dialog modal-dialog-centered modal-sm">
              <div className="modal-content border-0 shadow-lg rounded-4 p-3 bg-white">
                <div className="modal-header border-0 pb-0">
                  <h6 className="fw-bold mb-0">Close Ticket Evaluation</h6>
                  <button type="button" className="btn-close" onClick={() => setShowCloseModal(false)}></button>
                </div>
                <form onSubmit={handleConfirmCloseTicket} className="modal-body">
                  <p className="text-muted small mb-3">Provide a resolution evaluation summary before closing this ticket.</p>
                  
                  <div className="mb-3">
                    <label className="form-label small fw-semibold text-muted">Resolution Rating</label>
                    <select 
                      className="form-select form-select-sm" 
                      value={rating} 
                      onChange={(e) => setRating(Number(e.target.value))}
                    >
                      <option value={5}>⭐⭐⭐⭐⭐ (5 - Resolved Completely)</option>
                      <option value={4}>⭐⭐⭐⭐ (4 - Resolved with minor notes)</option>
                      <option value={3}>⭐⭐⭐ (3 - Moderate Resolution)</option>
                      <option value={2}>⭐⭐ (2 - Partially Resolved)</option>
                      <option value={1}>⭐ (1 - Unresolved / Escalated)</option>
                    </select>
                  </div>

                  <div className="mb-3">
                    <label className="form-label small fw-semibold text-muted">Evaluation Note</label>
                    <textarea 
                      required
                      className="form-control form-control-sm"
                      rows="3"
                      placeholder="e.g. Issue fixed after resetting student account credentials..."
                      value={evaluationNote}
                      onChange={(e) => setEvaluationNote(e.target.value)}
                    ></textarea>
                  </div>

                  <div className="d-flex gap-2 justify-content-end">
                    <button type="button" className="btn btn-light btn-sm rounded-pill" onClick={() => setShowCloseModal(false)}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-danger btn-sm rounded-pill fw-bold">
                      Confirm & Close
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}

export default Requests;