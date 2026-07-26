import { useEffect, useState } from "react";
import { auth, db } from "../firebase";
import { useNavigate } from "react-router-dom";
import {
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

function LearningPaths() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [paths, setPaths] = useState([]);
  const [appliedPaths, setAppliedPaths] = useState([]);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    title: "",
    level: "Beginner",
    description: "",
  });

  // Modal States
  const [modal, setModal] = useState({
    show: false,
    title: "",
    message: "",
    isConfirm: false,
    onConfirm: null,
  });

  // Helper to show modal
  const showAlert = (title, message) => {
    setModal({ show: true, title, message, isConfirm: false, onConfirm: null });
  };

  const showConfirm = (title, message, onConfirm) => {
    setModal({ show: true, title, message, isConfirm: true, onConfirm });
  };

  // Helper to check if user has management privileges (Admin or Admin Assistant with space/underscore support)
  const canManage = 
    user?.role === "admin" || 
    user?.role === "admin assistant" || 
    user?.role === "admin_assistant";

  // FETCH USER & APPLIED PATHS
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      try {
        if (!currentUser) {
          setUser(null);
        } else {
          const userDocSnap = await getDocs(collection(db, "users"));
          const userDoc = userDocSnap.docs.find((d) => d.id === currentUser.uid);
          const currentUserData = userDoc
            ? { uid: currentUser.uid, ...userDoc.data() }
            : { uid: currentUser.uid, fullname: "Student", role: "student" };
          setUser(currentUserData);

          if (currentUserData.role === "student") {
            const appliedSnap = await getDocs(
              collection(db, "users", currentUser.uid, "userPaths")
            );
            setAppliedPaths(appliedSnap.docs.map((d) => d.id));
          }
        }
      } catch (err) {
        console.error(err);
        setUser(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // FETCH LEARNING PATHS
  useEffect(() => {
    const fetchPaths = async () => {
      try {
        const snap = await getDocs(collection(db, "content"));
        const all = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((d) => d.type === "learning_path");
        setPaths(all);
      } catch (err) {
        console.error(err);
        setPaths([]);
      }
    };

    fetchPaths();
  }, []);

  // ADD PATH (Admin / Admin Assistant)
  const handleAddPath = async (e) => {
    e.preventDefault();
    if (!form.title || !form.description) {
      return showAlert("Missing Info", "All fields are required to publish a path.");
    }

    await addDoc(collection(db, "content"), {
      title: form.title,
      type: "learning_path",
      level: form.level,
      description: form.description,
      createdAt: serverTimestamp(),
    });

    setForm({ title: "", level: "Beginner", description: "" });
    showAlert("Success!", "The learning path has been published.");
    
    // Re-fetch instead of reload for better UX
    const snap = await getDocs(collection(db, "content"));
    setPaths(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => d.type === "learning_path"));
  };

  // DELETE PATH (Admin / Admin Assistant)
  const handleDeletePath = async (id) => {
    showConfirm(
      "Delete Path",
      "Are you sure you want to delete this learning path? This action cannot be undone.",
      async () => {
        await deleteDoc(doc(db, "content", id));
        setPaths((prev) => prev.filter((p) => p.id !== id));
      }
    );
  };

  // APPLY PATH (Student)
  const handleApplyPath = async (pathId) => {
    if (!user) {
      showAlert("Login Required", "You must log in to apply for this learning path.");
      setTimeout(() => navigate("/login"), 2000);
      return;
    }
    if (user.role !== "student") return;

    await setDoc(doc(db, "users", user.uid, "userPaths", pathId), {
      appliedAt: serverTimestamp(),
      completedLessons: [],
      achievements: [],
    });

    setAppliedPaths((prev) => [...prev, pathId]);
    showAlert("Enrolled!", "Successfully applied to the learning path. Happy learning!");
  };

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center vh-100 flex-column">
        <div className="spinner-grow text-primary" role="status"></div>
        <p className="mt-3 fw-bold text-muted text-uppercase small tracking-widest">Loading paths...</p>
      </div>
    );
  }

  return (
    <div className="bg-light min-vh-100">
      {/* HEADER SECTION */}
      <section className="bg-white py-5 border-bottom shadow-sm">
        <div className="container py-4">
          <div className="row justify-content-center text-center">
            <div className="col-lg-8">
              <h1 className="fw-bolder display-4 text-dark mb-3">Master New Skills</h1>
              <p className="lead text-secondary">
                Expert-led structured learning paths designed to take you from beginner to pro.
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="container py-5">
        <div className="row g-5">
          {/* ADMIN / ADMIN ASSISTANT FORM */}
          {canManage && (
            <div className="col-lg-4">
              <div className="card shadow-sm border-0 rounded-4 sticky-top" style={{ top: "20px" }}>
                <div className="card-body p-4">
                  <h4 className="fw-bold mb-4 text-primary">Create Path</h4>
                  <form onSubmit={handleAddPath}>
                    <div className="mb-3">
                      <label className="form-label small fw-bold text-uppercase text-muted">Path Title</label>
                      <input
                        className="form-control form-control-lg bg-light border-0"
                        placeholder="e.g. Web Development"
                        value={form.title}
                        onChange={(e) => setForm({ ...form, title: e.target.value })}
                        required
                      />
                    </div>

                    <div className="mb-3">
                      <label className="form-label small fw-bold text-uppercase text-muted">Skill Level</label>
                      <select
                        className="form-select bg-light border-0"
                        value={form.level}
                        onChange={(e) => setForm({ ...form, level: e.target.value })}
                      >
                        <option>Beginner</option>
                        <option>Intermediate</option>
                        <option>Advanced</option>
                      </select>
                    </div>

                    <div className="mb-4">
                      <label className="form-label small fw-bold text-uppercase text-muted">Description</label>
                      <textarea
                        className="form-control bg-light border-0"
                        rows={4}
                        placeholder="What will students learn?"
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                        required
                      />
                    </div>

                    <button className="btn btn-primary w-100 py-3 fw-bold shadow-sm">
                      Publish Path
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}

          {/* LIST */}
          <div className={canManage ? "col-lg-8" : "col-12"}>
            <div className="d-flex justify-content-between align-items-center mb-4">
              <h3 className="fw-bold m-0 text-dark">Available Paths</h3>
              <span className="badge bg-white text-dark border shadow-sm px-3 py-2 rounded-pill">
                {paths.length} Paths Found
              </span>
            </div>

            <div className="row g-4">
              {paths.length > 0 ? (
                paths.map((path) => (
                  <div key={path.id} className={canManage ? "col-md-6" : "col-md-4"}>
                    <div className="card h-100 border-0 shadow-sm rounded-4 hover-shadow transition">
                      <div className="card-body p-4 d-flex flex-column">
                        <div className="mb-3">
                          <span
                            className={`badge px-3 py-2 rounded-pill ${
                              path.level === "Beginner"
                                ? "bg-primary-subtle text-primary"
                                : path.level === "Intermediate"
                                ? "bg-success-subtle text-success"
                                : "bg-danger-subtle text-danger"
                            }`}
                          >
                            ● {path.level}
                          </span>
                        </div>
                        
                        <h5 className="fw-bold text-dark mb-2">{path.title}</h5>
                        <p className="text-muted small flex-grow-1" style={{ lineHeight: "1.6" }}>
                          {path.description}
                        </p>

                        <div className="mt-auto pt-4 border-top">
                          {canManage && (
                            <div className="d-flex gap-2">
                              <button
                                className="btn btn-sm btn-light text-danger fw-bold flex-grow-1"
                                onClick={() => handleDeletePath(path.id)}
                              >
                                Delete
                              </button>
                              <button
                                className="btn btn-sm btn-primary fw-bold flex-grow-1"
                                onClick={() => navigate("/viewpath", { state: { pathId: path.id } })}
                              >
                                Manage
                              </button>
                            </div>
                          )}

                          {user?.role === "student" && (
                            <div className="w-100">
                              {appliedPaths.includes(path.id) ? (
                                <button
                                  className="btn btn-success w-100 py-2 fw-bold"
                                  onClick={() => navigate("/viewpath", { state: { pathId: path.id } })}
                                >
                                  Continue Learning
                                </button>
                              ) : (
                                <button
                                  className="btn btn-primary w-100 py-2 fw-bold"
                                  onClick={() => handleApplyPath(path.id)}
                                >
                                  Enroll Now
                                </button>
                              )}
                            </div>
                          )}

                          {!user && (
                            <button
                              className="btn btn-primary w-100 py-2 fw-bold"
                              onClick={() => navigate("/login")}
                            >
                              Log in to Apply
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="col-12">
                  <div className="text-center bg-white py-5 rounded-4 shadow-sm">
                    <p className="text-muted mb-0">No learning paths have been created yet.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* CUSTOM MODAL COMPONENT */}
      {modal.show && (
        <div className="modal d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 1050 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-0 shadow-lg rounded-4">
              <div className="modal-header border-0 pb-0 pt-4 px-4">
                <h5 className="fw-bold text-dark">{modal.title}</h5>
              </div>
              <div className="modal-body p-4">
                <p className="text-muted mb-0">{modal.message}</p>
              </div>
              <div className="modal-footer border-0 pt-0 pb-4 px-4">
                {modal.isConfirm ? (
                  <>
                    <button className="btn btn-light px-4 rounded-pill fw-bold" onClick={() => setModal({ ...modal, show: false })}>
                      Cancel
                    </button>
                    <button 
                      className="btn btn-danger px-4 rounded-pill fw-bold" 
                      onClick={async () => {
                        await modal.onConfirm();
                        setModal({ ...modal, show: false });
                      }}
                    >
                      Confirm
                    </button>
                  </>
                ) : (
                  <button className="btn btn-primary px-5 rounded-pill fw-bold" onClick={() => setModal({ ...modal, show: false })}>
                    Okay
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .hover-shadow:hover {
          transform: translateY(-5px);
          box-shadow: 0 1rem 3rem rgba(0,0,0,.1) !important;
        }
        .transition {
          transition: all 0.3s ease;
        }
        .bg-primary-subtle { background-color: #e7f1ff; }
        .bg-success-subtle { background-color: #e6fcf5; }
        .bg-danger-subtle { background-color: #fff5f5; }
        .tracking-widest { letter-spacing: 0.1em; }
      `}</style>
    </div>
  );
}

export default LearningPaths;