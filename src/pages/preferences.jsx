import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { doc, updateDoc } from "firebase/firestore";
import { auth, db } from "../firebase";

function Preferences() {
  const navigate = useNavigate();
  const [selectedTracks, setSelectedTracks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState({ show: false, title: "", message: "", type: "success" });

  const itTracks = [
    {
      id: "web-dev",
      title: "Frontend & Web Development",
      description: "Build modern, responsive websites and web apps using React, JavaScript, Vite, and Bootstrap.",
      icon: "🌐",
    },
    {
      id: "mobile-dev",
      title: "Mobile App Development",
      description: "Create cross-platform mobile applications for iOS and Android using React Native and Expo.",
      icon: "📱",
    },
    {
      id: "backend-cloud",
      title: "Backend & Cloud Engineering",
      description: "Design robust server-side systems, handle databases with Firebase, and manage REST APIs.",
      icon: "☁️",
    },
    {
      id: "ui-ux",
      title: "UI/UX & Product Design",
      description: "Craft intuitive user experiences, wireframes, and visually stunning interfaces.",
      icon: "🎨",
    },
    {
      id: "cybersecurity",
      title: "Cybersecurity & Networking",
      description: "Learn fundamental network security, ethical hacking practices, and system defense protocols.",
      icon: "🔒",
    },
    {
      id: "data-ai",
      title: "Data Science & Artificial Intelligence",
      description: "Explore data analytics, machine learning models, and intelligent automation scripts.",
      icon: "🤖",
    },
  ];

  const toggleTrack = (id) => {
    if (selectedTracks.includes(id)) {
      setSelectedTracks(selectedTracks.filter((trackId) => trackId !== id));
    } else {
      setSelectedTracks([...selectedTracks, id]);
    }
  };

  const handleSavePreferences = async () => {
    if (selectedTracks.length === 0) {
      setModal({
        show: true,
        title: "Selection Required",
        message: "Please select at least one IT track to personalize your SkillPath experience.",
        type: "error",
      });
      return;
    }

    setLoading(true);
    try {
      const user = auth.currentUser;
      if (user) {
        await updateDoc(doc(db, "users", user.uid), {
          preferences: selectedTracks,
          onboarded: true,
        });
      }

      setModal({
        show: true,
        title: "Preferences Saved!",
        message: "Your learning path has been tailored successfully.",
        type: "success",
      });
    } catch (err) {
      console.error("Error saving preferences:", err);
      setModal({
        show: true,
        title: "Error",
        message: "Failed to save preferences. Please try again.",
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCloseModal = () => {
    const isSuccess = modal.type === "success";
    setModal({ ...modal, show: false });
    if (isSuccess) {
      navigate("/learningpaths");
    }
  };

  return (
    <>
      <style>{`
        .track-card {
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          cursor: pointer;
          border: 2px solid #e9ecef;
        }
        .track-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.075);
          border-color: #dee2e6;
        }
        .track-card.selected {
          border-color: #0d6efd;
          background-color: rgba(13, 110, 253, 0.02);
          transform: translateY(-3px);
          box-shadow: 0 0.5rem 1.5rem rgba(13, 110, 253, 0.15);
        }
        .icon-box {
          transition: transform 0.3s ease;
        }
        .track-card:hover .icon-box {
          transform: scale(1.1);
        }
      `}</style>

      <section className="bg-light py-5 border-bottom">
        <div className="container text-center py-4">
          <span className="badge bg-primary bg-opacity-10 text-primary px-3 py-2 rounded-pill fw-bold mb-3 text-uppercase tracking-wider">
            Personalize Your Journey
          </span>
          <h1 className="fw-bold display-5 text-dark">What do you want to master?</h1>
          <p className="lead text-muted mt-2 mx-auto" style={{ maxWidth: "600px" }}>
            Select your primary IT areas of interest so we can curate custom modules, coding projects, and learning pathways just for you.
          </p>
        </div>
      </section>

      <section className="py-5 bg-white">
        <div className="container" style={{ maxWidth: "1000px" }}>
          <div className="row g-4">
            {itTracks.map((track) => {
              const isSelected = selectedTracks.includes(track.id);
              return (
                <div key={track.id} className="col-md-6 col-lg-4">
                  <div
                    className={`card h-100 rounded-4 p-4 track-card position-relative ${
                      isSelected ? "selected" : ""
                    }`}
                    onClick={() => toggleTrack(track.id)}
                  >
                    {/* Selection Indicator Checkmark */}
                    <div className="position-absolute top-0 end-0 m-3">
                      <div
                        className={`rounded-circle d-flex align-items-center justify-content-center ${
                          isSelected ? "bg-primary text-white" : "bg-light text-muted border"
                        }`}
                        style={{ width: "28px", height: "28px", transition: "all 0.2s ease" }}
                      >
                        {isSelected ? "✓" : "+"}
                      </div>
                    </div>

                    <div className="card-body p-0 d-flex flex-column">
                      <div
                        className="icon-box fs-1 mb-3 bg-light rounded-4 d-inline-flex align-items-center justify-content-center"
                        style={{ width: "64px", height: "64px" }}
                      >
                        {track.icon}
                      </div>
                      <h4 className="fw-bold text-dark h5 mb-2">{track.title}</h4>
                      <p className="text-muted small mb-0 flex-grow-1">{track.description}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="text-center mt-5 pt-3">
            <button
              type="button"
              className="btn btn-primary btn-lg px-5 py-3 fw-bold rounded-pill shadow-sm"
              onClick={handleSavePreferences}
              disabled={loading}
            >
              {loading ? <span className="spinner-border spinner-border-sm me-2"></span> : null}
              {loading ? "Saving Preferences..." : "Continue to Learning Paths"}
            </button>
            <p className="text-muted small mt-3">
              You can always update your preferences later in your profile settings.
            </p>
          </div>
        </div>
      </section>

      {/* STATUS MODAL */}
      {modal.show && (
        <div className="modal d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 1070 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-0 shadow-lg rounded-4">
              <div className="modal-header border-0 pt-4 px-4 pb-0">
                <h5 className={`fw-bold ${modal.type === "error" ? "text-danger" : "text-success"}`}>
                  {modal.title}
                </h5>
              </div>
              <div className="modal-body p-4">
                <p className="text-muted mb-0">{modal.message}</p>
              </div>
              <div className="modal-footer border-0 pb-4 px-4">
                <button
                  className={`btn ${modal.type === "error" ? "btn-danger" : "btn-primary"} px-5 rounded-pill fw-bold w-100`}
                  onClick={handleCloseModal}
                >
                  {modal.type === "error" ? "Got It" : "View Learning Paths"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Preferences;