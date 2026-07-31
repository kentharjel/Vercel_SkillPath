import { useState, useEffect } from "react";
import { db, auth } from "../firebase";
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  doc, 
  updateDoc, 
  deleteDoc, 
  getDoc 
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";

function LiveClass() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);

  // Search state for room name or professor name
  const [searchQuery, setSearchQuery] = useState("");

  // Form states for Professor creation
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // Modal for Professor start/cancel card action
  const [selectedClass, setSelectedClass] = useState(null);
  const [showActionModal, setShowActionModal] = useState(false);

  // Student card click join modal state
  const [showStudentJoinModal, setShowStudentJoinModal] = useState(false);
  const [studentTargetClass, setStudentTargetClass] = useState(null);
  const [cardJoinCode, setCardJoinCode] = useState("");

  // 3-dots card menu state
  const [activeMenuId, setActiveMenuId] = useState(null);

  // Student code join state & Modern Info Modal message
  const [joinCode, setJoinCode] = useState("");
  const [infoModalMessage, setInfoModalMessage] = useState("");

  // Confirmation Modal State (replaces window.confirm)
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState({
    title: "",
    message: "",
    onConfirm: null
  });

  useEffect(() => {
    const unsubscribeAuth = auth.onAuthStateChanged(async (currentUser) => {
      if (currentUser) {
        const userDoc = await getDoc(doc(db, "users", currentUser.uid));
        if (userDoc.exists()) {
          setUser({ uid: currentUser.uid, ...userDoc.data() });
        } else {
          setUser({ uid: currentUser.uid, role: "student" });
        }
      } else {
        setUser(null);
      }
    });

    // Listen to live classes in real-time
    const unsubscribeClasses = onSnapshot(collection(db, "live_classes"), (snapshot) => {
      const classList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setClasses(classList);
      setLoading(false);
    });

    // Close 3-dots menu on outside click
    const handleClickOutside = () => setActiveMenuId(null);
    window.addEventListener("click", handleClickOutside);

    return () => {
      unsubscribeAuth();
      unsubscribeClasses();
      window.removeEventListener("click", handleClickOutside);
    };
  }, []);

  // Generate unique class code
  const generateCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase() + Math.floor(1000 + Math.random() * 9000);
  };

  const handleCreateClass = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;

    try {
      await addDoc(collection(db, "live_classes"), {
        title,
        description,
        code: generateCode().slice(0, 6),
        started: false,
        createdBy: user.uid,
        creatorName: user.fullname || "Professor",
        createdAt: new Date()
      });
      setTitle("");
      setDescription("");
      setShowCreateModal(false);
    } catch (err) {
      console.error("Error creating live class:", err);
    }
  };

  const handleCardClick = (cls) => {
    if (user?.role === "professor" || user?.role === "admin" || cls.createdBy === user?.uid) {
      setSelectedClass(cls);
      setShowActionModal(true);
    } else {
      if (!cls.started) {
        setInfoModalMessage("This class has not been started by the professor yet. Please check back later.");
      } else {
        setStudentTargetClass(cls);
        setCardJoinCode("");
        setShowStudentJoinModal(true);
      }
    }
  };

  const startClassSession = async () => {
    if (!selectedClass) return;
    try {
      await updateDoc(doc(db, "live_classes", selectedClass.id), { started: true });
      setShowActionModal(false);
      navigate(`/room/${selectedClass.code}`);
    } catch (err) {
      console.error("Error starting class:", err);
    }
  };

  const deleteClassSession = async (classId, e) => {
    if (e) e.stopPropagation();
    
    setConfirmConfig({
      title: "Delete Class",
      message: "Are you sure you want to delete this live class? This action cannot be undone.",
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, "live_classes", classId));
          setActiveMenuId(null);
          setShowConfirmModal(false);
        } catch (err) {
          console.error("Error deleting class:", err);
        }
      }
    });
    setShowConfirmModal(true);
  };

  const handleJoinByCode = (e) => {
    e.preventDefault();
    const trimmedCode = joinCode.trim().toUpperCase();
    if (!trimmedCode) {
      setInfoModalMessage("Please enter a valid 6-digit class code.");
      return;
    }

    const found = classes.find(c => c.code.toUpperCase() === trimmedCode);
    if (!found) {
      setInfoModalMessage("Invalid class code. Please check the code and try again.");
      return;
    }

    if (!found.started) {
      setInfoModalMessage("Class is found, but the professor has not started the room yet. You cannot enter at this time.");
      return;
    }

    navigate(`/room/${found.code}`);
  };

  const handleStudentCardCodeSubmit = (e) => {
    e.preventDefault();
    if (!studentTargetClass) return;
    const trimmedCode = cardJoinCode.trim().toUpperCase();
    
    if (trimmedCode !== studentTargetClass.code.toUpperCase()) {
      setInfoModalMessage("Incorrect class code. Please verify with your professor and try again.");
      return;
    }

    setShowStudentJoinModal(false);
    navigate(`/room/${studentTargetClass.code}`);
  };

  const copyCodeToClipboard = (code, e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(code);
    setInfoModalMessage(`Class code "${code}" copied to clipboard!`);
  };

  // Filtered classes based on room title or professor name
  const filteredClasses = classes.filter(cls => {
    const query = searchQuery.toLowerCase();
    const titleMatch = cls.title?.toLowerCase().includes(query);
    const creatorMatch = cls.creatorName?.toLowerCase().includes(query);
    return titleMatch || creatorMatch;
  });

  return (
    <div className="container-fluid min-vh-100 py-4 py-md-5 px-3 px-md-5" style={{ backgroundColor: "#f8fafc", color: "#1e293b" }}>
      {/* Header Section */}
      <div className="row align-items-center mb-4 pb-3 border-bottom border-light g-3">
        <div className="col-12 col-md">
          <div className="d-flex align-items-center gap-2 mb-1">
            <span className="p-2 rounded-3 bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center">
              <ion-icon name="tv-outline" style={{ fontSize: "22px" }}></ion-icon>
            </span>
            <h2 className="fw-bold text-dark mb-0 fs-3">Live Virtual Classes</h2>
          </div>
          <p className="text-muted mb-0 small">Join real-time interactive video sessions or manage your virtual lectures seamlessly.</p>
        </div>
        <div className="col-12 col-md-auto d-flex gap-2">
          {(user?.role === "professor" || user?.role === "admin") && (
            <button 
              className="btn btn-primary rounded-pill px-4 shadow-sm fw-semibold d-flex align-items-center justify-content-center gap-2 w-100 w-md-auto" 
              onClick={() => setShowCreateModal(true)}
            >
              <ion-icon name="add-circle-outline" style={{ fontSize: "18px" }}></ion-icon> Create Live Class
            </button>
          )}
        </div>
      </div>

      {/* Top Search & Join Code Section */}
      <div className="row g-3 mb-4">
        {/* Join via Code bar */}
        <div className="col-12 col-lg-7">
          <div className="card border-0 shadow-sm rounded-4 p-3 bg-white h-100" style={{ border: "1px solid #e2e8f0" }}>
            <form onSubmit={handleJoinByCode} className="row g-2 align-items-center">
              <div className="col-12 col-sm-8">
                <div className="input-group">
                  <span className="input-group-text bg-light border-0 text-primary ps-3 rounded-start-pill">
                    <ion-icon name="key-outline" style={{ fontSize: "18px" }}></ion-icon>
                  </span>
                  <input 
                    type="text" 
                    className="form-control bg-light text-dark border-0 shadow-none rounded-end-pill px-3 font-monospace" 
                    placeholder="Enter 6-digit Code..." 
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    style={{ fontSize: "14px" }}
                  />
                </div>
              </div>
              <div className="col-12 col-sm-4">
                <button type="submit" className="btn btn-primary w-100 rounded-pill shadow-sm fw-semibold d-flex align-items-center justify-content-center gap-2 py-2" style={{ fontSize: "14px" }}>
                  <span>Join Code</span>
                  <ion-icon name="arrow-forward-outline"></ion-icon>
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Search Bar */}
        <div className="col-12 col-lg-5">
          <div className="card border-0 shadow-sm rounded-4 p-3 bg-white h-100" style={{ border: "1px solid #e2e8f0" }}>
            <div className="input-group">
              <span className="input-group-text bg-light border-0 text-primary ps-3 rounded-start-pill">
                <ion-icon name="search-outline" style={{ fontSize: "18px" }}></ion-icon>
              </span>
              <input 
                type="text" 
                className="form-control bg-light text-dark border-0 shadow-none rounded-end-pill px-3" 
                placeholder="Search room name or professor..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ fontSize: "14px" }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Classes Grid */}
      <div className="row g-4">
        {loading ? (
          <div className="text-center py-5">
            <div className="spinner-border text-primary" role="status"></div>
          </div>
        ) : filteredClasses.length === 0 ? (
          <div className="text-center py-5 text-muted col-12">
            <div className="mb-2 text-primary opacity-50">
              <ion-icon name="videocam-off-outline" style={{ fontSize: "48px" }}></ion-icon>
            </div>
            <h5 className="text-dark fw-semibold">No live classes found.</h5>
            <p className="small">Try adjusting your search query or check back later.</p>
          </div>
        ) : (
          filteredClasses.map((cls) => (
            <div className="col-12 col-md-6 col-lg-4" key={cls.id}>
              <motion.div 
                whileHover={{ y: -4 }}
                className="card border-0 shadow-sm rounded-4 h-100 overflow-hidden bg-white"
                onClick={() => handleCardClick(cls)}
                style={{ cursor: "pointer", border: "1px solid #e2e8f0", transition: "box-shadow 0.2s ease" }}
              >
                <div className={`card-header border-0 py-3 px-4 ${cls.started ? "bg-success bg-opacity-10 text-success border-bottom border-success border-opacity-10" : "bg-light text-muted border-bottom border-light"}`}>
                  <div className="d-flex justify-content-between align-items-center">
                    <span className={`badge ${cls.started ? "bg-success text-white" : "bg-secondary bg-opacity-10 text-secondary"} fw-bold px-3 py-2 rounded-pill d-flex align-items-center gap-1`} style={{ fontSize: "11px" }}>
                      <ion-icon name={cls.started ? "radio-button-on-outline" : "time-outline"}></ion-icon>
                      {cls.started ? "LIVE NOW" : "SCHEDULED"}
                    </span>
                    {(user?.role === "professor" || user?.role === "admin" || cls.createdBy === user?.uid) && (
                      <div className="d-flex align-items-center gap-2">
                        <button 
                          className="btn btn-sm btn-light bg-white px-2 py-1 rounded text-primary border border-primary border-opacity-25 shadow-sm d-flex align-items-center gap-1 font-monospace"
                          onClick={(e) => copyCodeToClipboard(cls.code, e)}
                          title="Copy Class Code"
                          style={{ fontSize: "12px" }}
                        >
                          <span>{cls.code}</span>
                          <ion-icon name="copy-outline"></ion-icon>
                        </button>
                        
                        {/* 3-Dots Menu Button */}
                        <div className="position-relative">
                          <button 
                            className="btn btn-sm btn-light p-1 rounded-circle text-muted d-flex align-items-center justify-content-center bg-white border shadow-sm"
                            style={{ width: "28px", height: "28px" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveMenuId(activeMenuId === cls.id ? null : cls.id);
                            }}
                          >
                            <ion-icon name="ellipsis-vertical-outline" style={{ fontSize: "14px" }}></ion-icon>
                          </button>
                          
                          {activeMenuId === cls.id && (
                            <div className="position-absolute end-0 mt-1 bg-white shadow-lg rounded-3 border p-1" style={{ zIndex: 100, minWidth: "130px" }}>
                              <button 
                                className="dropdown-item small text-danger rounded py-1 px-2 d-flex align-items-center gap-2 fw-semibold bg-white"
                                onClick={(e) => deleteClassSession(cls.id, e)}
                              >
                                <ion-icon name="trash-outline" style={{ fontSize: "14px" }}></ion-icon> Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="card-body p-4 d-flex flex-column">
                  <h4 className="fw-bold text-dark mb-2 fs-5">{cls.title}</h4>
                  <p className="text-muted small mb-4 flex-grow-1" style={{ lineHeight: "1.6" }}>{cls.description || "No description provided for this session."}</p>
                  
                  <div className="d-flex justify-content-between align-items-center pt-3 border-top border-light">
                    <span className="small text-muted fw-semibold d-flex align-items-center gap-1">
                      <ion-icon name="person-outline"></ion-icon> {cls.creatorName}
                    </span>
                    <span className={`btn btn-sm ${cls.started ? "btn-primary" : "btn-outline-primary"} rounded-pill px-3 fw-semibold`}>
                      {user?.role === "professor" || cls.createdBy === user?.uid ? "Manage" : cls.started ? "Join Room" : "Waiting..."}
                    </span>
                  </div>
                </div>
              </motion.div>
            </div>
          ))
        )}
      </div>

      {/* Professor Create Class Modal */}
      {showCreateModal && (
        <div className="modal d-block d-flex align-items-center justify-content-center" style={{ backgroundColor: "rgba(15, 23, 42, 0.45)", backdropFilter: "blur(6px)", zIndex: 2000 }}>
          <div className="modal-dialog modal-dialog-centered px-3 w-100" style={{ maxWidth: "500px" }}>
            <div className="modal-content border-0 shadow-lg rounded-4 p-3 text-dark bg-white" style={{ border: "1px solid #e2e8f0" }}>
              <div className="modal-header border-0 pb-0">
                <h5 className="fw-bold text-primary d-flex align-items-center gap-2 fs-5">
                  <ion-icon name="create-outline"></ion-icon> Create New Live Class
                </h5>
                <button type="button" className="btn-close shadow-none" onClick={() => setShowCreateModal(false)}></button>
              </div>
              <form onSubmit={handleCreateClass}>
                <div className="modal-body py-4">
                  <div className="mb-3">
                    <label className="form-label fw-semibold text-muted small">Class Title</label>
                    <input 
                      type="text" 
                      className="form-control bg-light text-dark border-0 rounded-pill px-3 py-2 shadow-none" 
                      placeholder="e.g., Advanced React Hooks" 
                      value={title} 
                      onChange={(e) => setTitle(e.target.value)} 
                      required 
                    />
                  </div>
                  <div className="mb-0">
                    <label className="form-label fw-semibold text-muted small">Description</label>
                    <textarea 
                      className="form-control bg-light text-dark border-0 rounded-4 p-3 shadow-none" 
                      rows="3" 
                      placeholder="What will be covered in this session?" 
                      value={description} 
                      onChange={(e) => setDescription(e.target.value)}
                    ></textarea>
                  </div>
                </div>
                <div className="modal-footer border-0 pt-0">
                  <button type="button" className="btn btn-light rounded-pill px-4 text-muted fw-semibold" onClick={() => setShowCreateModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary rounded-pill px-4 fw-semibold shadow-sm">Create Class</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Small & Clean Professor Action Modal (Start / Cancel Side-by-side) */}
      {showActionModal && selectedClass && (
        <div className="modal d-block d-flex align-items-center justify-content-center" style={{ backgroundColor: "rgba(15, 23, 42, 0.45)", backdropFilter: "blur(6px)", zIndex: 2000 }}>
          <div className="modal-dialog modal-dialog-centered modal-sm px-3 w-100" style={{ maxWidth: "360px" }}>
            <div className="modal-content border-0 shadow-lg rounded-4 p-3 text-center text-dark bg-white" style={{ border: "1px solid #e2e8f0" }}>
              <div className="d-flex justify-content-end mb-1">
                <button type="button" className="btn-close shadow-none" style={{ fontSize: "12px" }} onClick={() => setShowActionModal(false)}></button>
              </div>
              <div className="mb-3">
                <span className="p-2 rounded-circle bg-primary bg-opacity-10 text-primary d-inline-flex align-items-center justify-content-center mb-2">
                  <ion-icon name="videocam-outline" style={{ fontSize: "24px" }}></ion-icon>
                </span>
                <h5 className="fw-bold mb-1 text-dark text-truncate px-2 fs-6">{selectedClass.title}</h5>
                <div className="d-flex align-items-center justify-content-center gap-1 mt-2">
                  <span className="text-muted small">Code:</span>
                  <button 
                    className="btn btn-sm btn-light bg-light px-2 py-1 rounded text-primary border border-primary border-opacity-25 fw-bold font-monospace d-flex align-items-center gap-1 shadow-sm"
                    onClick={(e) => copyCodeToClipboard(selectedClass.code, e)}
                    title="Copy Code"
                    style={{ fontSize: "11px" }}
                  >
                    <span>{selectedClass.code}</span>
                    <ion-icon name="copy-outline"></ion-icon>
                  </button>
                </div>
              </div>
              
              <div className="d-flex gap-2">
                <button className="btn btn-outline-secondary rounded-pill fw-semibold py-2 flex-grow-1" style={{ fontSize: "13px" }} onClick={() => setShowActionModal(false)}>
                  Cancel
                </button>
                <button className="btn btn-success rounded-pill fw-bold shadow-sm d-flex align-items-center justify-content-center gap-1 py-2 flex-grow-1" style={{ fontSize: "13px" }} onClick={startClassSession}>
                  <ion-icon name="play-circle-outline" style={{ fontSize: "16px" }}></ion-icon>
                  Start
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Student Code Input Modal when clicking a live class card */}
      {showStudentJoinModal && studentTargetClass && (
        <div className="modal d-block d-flex align-items-center justify-content-center" style={{ backgroundColor: "rgba(15, 23, 42, 0.45)", backdropFilter: "blur(6px)", zIndex: 2000 }}>
          <div className="modal-dialog modal-dialog-centered modal-sm px-3 w-100" style={{ maxWidth: "360px" }}>
            <div className="modal-content border-0 shadow-lg rounded-4 p-3 text-center text-dark bg-white" style={{ border: "1px solid #e2e8f0" }}>
              <div className="d-flex justify-content-end mb-1">
                <button type="button" className="btn-close shadow-none" style={{ fontSize: "12px" }} onClick={() => setShowStudentJoinModal(false)}></button>
              </div>
              <div className="mb-3">
                <span className="p-2 rounded-circle bg-primary bg-opacity-10 text-primary d-inline-flex align-items-center justify-content-center mb-2">
                  <ion-icon name="key-outline" style={{ fontSize: "24px" }}></ion-icon>
                </span>
                <h5 className="fw-bold mb-1 text-dark text-truncate px-2 fs-6">{studentTargetClass.title}</h5>
                <p className="text-muted small px-2 mb-3" style={{ fontSize: "12px" }}>Enter the 6-digit access code provided by your professor to join this session.</p>
                
                <form onSubmit={handleStudentCardCodeSubmit}>
                  <div className="mb-3">
                    <input 
                      type="text" 
                      className="form-control bg-light text-dark border-0 rounded-pill text-center py-2 font-monospace shadow-none fw-bold" 
                      placeholder="ENTER CODE"
                      value={cardJoinCode}
                      onChange={(e) => setCardJoinCode(e.target.value)}
                      maxLength={6}
                      autoFocus
                      required
                      style={{ fontSize: "16px", letterSpacing: "2px" }}
                    />
                  </div>
                  <div className="d-flex gap-2">
                    <button type="button" className="btn btn-outline-secondary rounded-pill fw-semibold py-2 flex-grow-1" style={{ fontSize: "13px" }} onClick={() => setShowStudentJoinModal(false)}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary rounded-pill fw-bold shadow-sm py-2 flex-grow-1" style={{ fontSize: "13px" }}>
                      Join Room
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modern Confirmation Modal (Replaces browser window.confirm) */}
      {showConfirmModal && (
        <div className="modal d-block d-flex align-items-center justify-content-center" style={{ backgroundColor: "rgba(15, 23, 42, 0.45)", backdropFilter: "blur(6px)", zIndex: 2200 }}>
          <div className="modal-dialog modal-dialog-centered modal-sm px-3 w-100" style={{ maxWidth: "360px" }}>
            <div className="modal-content border-0 shadow-lg rounded-4 p-3 text-center text-dark bg-white" style={{ border: "1px solid #e2e8f0" }}>
              <div className="mb-3">
                <span className="p-2 rounded-circle bg-danger bg-opacity-10 text-danger d-inline-flex align-items-center justify-content-center mb-2">
                  <ion-icon name="trash-outline" style={{ fontSize: "26px" }}></ion-icon>
                </span>
                <h6 className="fw-bold text-dark mb-1">{confirmConfig.title}</h6>
                <p className="text-muted small mb-0 px-2" style={{ fontSize: "13px", lineHeight: "1.4" }}>{confirmConfig.message}</p>
              </div>
              <div className="d-flex gap-2">
                <button className="btn btn-outline-secondary rounded-pill fw-semibold py-2 flex-grow-1" style={{ fontSize: "13px" }} onClick={() => setShowConfirmModal(false)}>
                  Cancel
                </button>
                <button className="btn btn-danger rounded-pill fw-semibold py-2 flex-grow-1 shadow-sm" style={{ fontSize: "13px" }} onClick={confirmConfig.onConfirm}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modern Info / Warning Modal */}
      {infoModalMessage && (
        <div className="modal d-block d-flex align-items-center justify-content-center" style={{ backgroundColor: "rgba(15, 23, 42, 0.45)", backdropFilter: "blur(6px)", zIndex: 2100 }}>
          <div className="modal-dialog modal-dialog-centered modal-sm px-3 w-100" style={{ maxWidth: "360px" }}>
            <div className="modal-content border-0 shadow-lg rounded-4 p-3 text-center text-dark bg-white" style={{ border: "1px solid #e2e8f0" }}>
              <div className="mb-3">
                <span className="p-2 rounded-circle bg-warning bg-opacity-10 text-warning d-inline-flex align-items-center justify-content-center mb-2">
                  <ion-icon name="alert-circle-outline" style={{ fontSize: "26px" }}></ion-icon>
                </span>
                <h6 className="fw-bold text-dark mb-1">Notice</h6>
                <p className="text-muted small mb-0 px-2" style={{ fontSize: "13px", lineHeight: "1.4" }}>{infoModalMessage}</p>
              </div>
              <div className="d-grid">
                <button className="btn btn-primary rounded-pill fw-semibold py-2 shadow-sm" style={{ fontSize: "13px" }} onClick={() => setInfoModalMessage("")}>
                  Got It
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LiveClass;