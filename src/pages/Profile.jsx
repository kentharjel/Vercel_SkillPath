import { useEffect, useState } from "react";
import { auth, db } from "../firebase";
import { supabase } from "../supabase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, updateDoc, collection, getDocs, query, where } from "firebase/firestore";
import { motion, AnimatePresence } from "framer-motion";

function Profile() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [newName, setNewName] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [saving, setSaving] = useState(false);
  
  const [profileStats, setProfileStats] = useState({
    lessonsCount: 0,
    pathsCount: 0,
    classesCount: 0,
  });

  // IT Tracks Reference for Preferences Mapping
  const IT_TRACKS = [
    { id: "web-dev", title: "Web Dev", icon: "🌐", label: "Frontend & Web Development" },
    { id: "mobile-dev", title: "Mobile App", icon: "📱", label: "Mobile App Development" },
    { id: "backend-cloud", title: "Backend & Cloud", icon: "☁️", label: "Backend & Cloud Engineering" },
    { id: "ui-ux", title: "UI/UX", icon: "🎨", label: "UI/UX & Product Design" },
    { id: "cybersecurity", title: "Cybersecurity", icon: "🔒", label: "Cybersecurity & Networking" },
    { id: "data-ai", title: "Data & AI", icon: "🤖", label: "Data Science & AI" },
  ];

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        try {
          const userDocRef = doc(db, "users", currentUser.uid);
          const userSnap = await getDoc(userDocRef);
          
          let userData = {
            uid: currentUser.uid,
            fullname: currentUser.displayName || "User",
            role: "student",
            email: currentUser.email,
            photoURL: currentUser.photoURL || null,
          };

          if (userSnap.exists()) {
            userData = { ...userData, ...userSnap.data() };
          }
          
          setUser(userData);
          setNewName(userData.fullname);

          let lessons = 0;
          let paths = 0;
          let classes = 0;

          if (userData.role === "student") {
            const pathsSnap = await getDocs(collection(db, "users", currentUser.uid, "userPaths"));
            pathsSnap.forEach((pDoc) => {
              const pData = pDoc.data();
              lessons += pData.completedLessons?.length || 0;
            });
            paths = pathsSnap.size;

            const classesQuery = query(collection(db, "classes"), where("students", "array-contains", currentUser.uid));
            const classesSnap = await getDocs(classesQuery);
            classes = classesSnap.size;

          } else if (userData.role === "professor") {
            const classesQuery = query(collection(db, "classes"), where("professorId", "==", currentUser.uid));
            const classesSnap = await getDocs(classesQuery);
            classes = classesSnap.size;

          } else if (userData.role === "admin assistant") {
            const classesSnap = await getDocs(collection(db, "classes"));
            classes = classesSnap.size;
          }

          setProfileStats({
            lessonsCount: lessons,
            pathsCount: paths,
            classesCount: classes,
          });

        } catch (error) {
          console.error("Error loading account records:", error);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!newName.trim() || !user) return;
    setSaving(true);

    try {
      let finalPhotoUrl = user.photoURL || null;

      if (imageFile) {
        const fileExt = imageFile.name.split('.').pop();
        const filePath = `${user.uid}/avatar_${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(filePath, imageFile, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
          .from("avatars")
          .getPublicUrl(filePath);

        finalPhotoUrl = publicUrlData.publicUrl;
      }

      const userDocRef = doc(db, "users", user.uid);
      const updatedData = {
        fullname: newName,
        photoURL: finalPhotoUrl,
      };

      await updateDoc(userDocRef, updatedData);

      setUser((prev) => ({
        ...prev,
        fullname: newName,
        photoURL: finalPhotoUrl,
      }));

      setIsEditing(false);
      setImageFile(null);
      setImagePreview(null);
    } catch (error) {
      console.error("Error updating profile:", error.message);
      alert("Failed to update profile: " + error.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="container py-5 text-center" style={{ marginTop: "80px" }}>
        <div className="spinner-border text-primary" role="status"></div>
        <p className="text-muted mt-3">Loading profile configuration...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container py-5 text-center" style={{ marginTop: "80px" }}>
        <h4 className="fw-bold">Access Denied</h4>
        <p className="text-muted">Please sign in to view this configuration dashboard.</p>
      </div>
    );
  }

  return (
    <div className="bg-light min-vh-100 py-5" style={{ marginTop: "20px" }}>
      <div className="container">
        <div className="row justify-content-center">
          <div className="col-lg-9">
            
            {/* DESIGN-RICH HEAD BANNER */}
            <motion.div 
              className="card border-0 shadow-sm rounded-4 overflow-hidden mb-4 bg-white"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="bg-primary py-5 px-4 position-relative" style={{ minHeight: "140px" }}>
                <span className="position-absolute top-0 end-0 m-3 badge bg-white text-primary fw-bold text-uppercase px-3 py-2 rounded-pill shadow-sm">
                  {user.role} workspace
                </span>
              </div>
              
              <div className="card-body px-4 pb-4 pt-0 position-relative">
                <div className="position-absolute" style={{ top: "-60px", left: "24px" }}>
                  <div className="bg-white rounded-circle p-1 shadow-sm">
                    {user.photoURL ? (
                      <img 
                        src={user.photoURL} 
                        alt={user.fullname} 
                        className="rounded-circle object-fit-cover" 
                        style={{ width: "110px", height: "110px" }}
                      />
                    ) : (
                      <div className="bg-primary bg-gradient rounded-circle text-white d-flex align-items-center justify-content-center fw-bold fs-1" style={{ width: "110px", height: "110px" }}>
                        {user.fullname.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                </div>

                <div className="d-flex justify-content-end pt-3 mb-4">
                  <button className="btn btn-outline-primary btn-sm px-4 rounded-pill fw-bold" onClick={() => setIsEditing(true)}>
                    Edit Profile
                  </button>
                </div>

                <div className="pt-3">
                  <h3 className="fw-bold text-dark mb-1">{user.fullname}</h3>
                  <p className="text-muted small mb-0">@{user.email?.split("@")[0]} • {user.email}</p>
                </div>
              </div>
            </motion.div>

            {/* CHOSEN PREFERENCES SECTION */}
            <motion.div 
              className="card border-0 shadow-sm rounded-4 p-4 mb-4 bg-white"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <div className="d-flex align-items-center mb-3">
                <span className="fs-4 me-2">🎯</span>
                <h5 className="fw-bold text-dark mb-0">Chosen IT Track Preferences</h5>
              </div>
              {user.preferences && user.preferences.length > 0 ? (
                <div className="d-flex flex-wrap gap-2">
                  {user.preferences.map((prefId) => {
                    const track = IT_TRACKS.find((t) => t.id === prefId);
                    return track ? (
                      <div 
                        key={track.id} 
                        className="badge bg-light text-dark border px-3 py-2 rounded-pill d-flex align-items-center gap-2 fs-6 fw-semibold shadow-sm"
                      >
                        <span>{track.icon}</span>
                        <span>{track.label}</span>
                      </div>
                    ) : null;
                  })}
                </div>
              ) : (
                <p className="text-muted small mb-0">No IT track preferences selected yet.</p>
              )}
            </motion.div>

            {/* WIDGET STATS GRID */}
            <div className="row g-4">
              {user.role === "student" && (
                <>
                  <StatWidgetCard title="Lessons Logged" value={profileStats.lessonsCount} icon="📚" description="Completed learning items" />
                  <StatWidgetCard title="Paths Managed" value={profileStats.pathsCount} icon="🗺️" description="Total learning modules started" />
                  <StatWidgetCard title="Classroom Sync" value={profileStats.classesCount} icon="🏫" description="Active course spaces enrolled" />
                </>
              )}

              {user.role === "professor" && (
                <>
                  <StatWidgetCard title="Classrooms Live" value={profileStats.classesCount} icon="👨‍🏫" description="Active lecture spaces managed" />
                  <StatWidgetCard title="Verification Profile" value="Verified" icon="🛡️" description="Instructor status active" />
                  <StatWidgetCard title="Curriculum Space" value="Standard" icon="📝" description="Custom tracking parameters" />
                </>
              )}

              {user.role === "admin assistant" && (
                <>
                  <StatWidgetCard title="System Control" value="Semi-Full Access" icon="⚙️" description="Elevated operational tools active" />
                  <StatWidgetCard title="Cluster Status" value="Online" icon="⚡" description="Connected to Firestore cluster" />
                  <StatWidgetCard title="Security Group" value="Level-1" icon="🔑" description="Secondary assistant credentials" />
                </>
              )}

              {user.role === "admin" && (
                <>
                  <StatWidgetCard title="System Control" value="Full Access" icon="⚙️" description="Global platform rules active" />
                  <StatWidgetCard title="Cluster Status" value="Online" icon="⚡" description="Connected to Firestore cluster" />
                  <StatWidgetCard title="Security Group" value="Level-2" icon="🔑" description="Primary root credentials" />
                </>
              )}
            </div>

          </div>
        </div>
      </div>

      {/* EDIT PROFILE MODAL */}
      <AnimatePresence>
        {isEditing && (
          <motion.div 
            className="modal d-block" 
            style={{ backgroundColor: "rgba(0,0,0,0.4)", zIndex: 2050 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="modal-dialog modal-dialog-centered">
              <motion.div 
                className="modal-content border-0 shadow-lg rounded-4"
                initial={{ scale: 0.95, y: 15 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.95, y: 15 }}
              >
                <form onSubmit={handleSaveProfile}>
                  <div className="modal-header border-0 pb-0 pt-4 px-4">
                    <h5 className="fw-bold m-0">Edit Profile</h5>
                  </div>

                  <div className="modal-body p-4">
                    <div className="text-center mb-4">
                      <div className="position-relative d-inline-block">
                        <img 
                          src={imagePreview || user.photoURL || `https://via.placeholder.com/100?text=${user.fullname.charAt(0)}`} 
                          alt="Preview" 
                          className="rounded-circle object-fit-cover shadow-sm mb-2" 
                          style={{ width: "100px", height: "100px" }}
                        />
                      </div>
                      <div>
                        <label htmlFor="avatarInput" className="btn btn-sm btn-outline-secondary rounded-pill px-3 fw-bold mt-1">
                          Choose New Photo
                        </label>
                        <input 
                          type="file" 
                          id="avatarInput" 
                          accept="image/*" 
                          className="d-none" 
                          onChange={handleImageChange}
                        />
                      </div>
                    </div>

                    <div className="mb-0">
                      <label className="form-label small fw-bold text-muted">Display Name</label>
                      <input 
                        type="text" 
                        required
                        className="form-control rounded-3" 
                        value={newName} 
                        onChange={(e) => setNewName(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="modal-footer border-0 pt-0 pb-4 px-4 gap-2">
                    <button 
                      type="button" 
                      className="btn btn-light px-4 rounded-pill fw-bold" 
                      onClick={() => { 
                        setIsEditing(false); 
                        setNewName(user.fullname); 
                        setImagePreview(null);
                        setImageFile(null);
                      }}
                    >
                      Cancel
                    </button>
                    <button type="submit" disabled={saving} className="btn btn-primary px-4 rounded-pill fw-bold">
                      {saving ? "Saving..." : "Save Changes"}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const StatWidgetCard = ({ title, value, icon, description }) => (
  <div className="col-md-4">
    <motion.div 
      className="card border-0 shadow-sm rounded-4 p-4 h-100 bg-white"
      whileHover={{ y: -3 }}
      transition={{ duration: 0.2 }}
    >
      <div className="d-flex align-items-center mb-2">
        <span className="fs-4 me-3">{icon}</span>
        <h6 className="fw-bold text-muted mb-0 small text-uppercase tracking-wider" style={{ fontSize: '0.75rem' }}>{title}</h6>
      </div>
      <h2 className="fw-black text-dark mb-1">{value}</h2>
      <p className="text-muted small mb-0">{description}</p>
    </motion.div>
  </div>
);

export default Profile;