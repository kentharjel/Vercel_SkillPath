import { useEffect, useState } from "react";
import { auth, db } from "./firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";
import { Navigate } from "react-router-dom";
import {
  AiOutlineEdit,
  AiOutlineDelete,
  AiOutlineUserAdd,
  AiOutlineSearch,
  AiOutlineUser,
  AiOutlineIdcard,
  AiOutlineExclamationCircle,
  AiOutlineTrophy,
  AiOutlineBook,
  AiOutlineSolution,
  AiOutlineTeam,
} from "react-icons/ai";

function Admin() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState([]);
  const [professors, setProfessors] = useState([]);
  const [assistants, setAssistants] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");

  // --- MODAL STATES ---
  const [editTarget, setEditTarget] = useState(null); // stores {id, fullname}
  const [deleteTarget, setDeleteTarget] = useState(null); // stores id
  const [promoteTarget, setPromoteTarget] = useState(null); // stores {id, fullname}
  const [assistantTarget, setAssistantTarget] = useState(null); // stores {id, fullname}
  const [selectedUser, setSelectedUser] = useState(null); // stores full user object for details modal

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        setUser(null);
        setLoading(false);
        return;
      }
      const snap = await getDoc(doc(db, "users", currentUser.uid));
      if (!snap.exists() || snap.data().role !== "admin") {
        setUser("unauthorized");
        setLoading(false);
        return;
      }
      setUser({ uid: currentUser.uid, ...snap.data() });
      await fetchUsers();
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const fetchUsers = async () => {
    const snap = await getDocs(collection(db, "users"));
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    setStudents(all.filter((u) => u.role === "student"));
    setProfessors(all.filter((u) => u.role === "professor"));
    setAssistants(all.filter((u) => u.role === "admin assistant" || u.role === "admin_assistant"));
  };

  /* MODAL HANDLERS */
  const handleConfirmEdit = async () => {
    if (!editTarget.fullname.trim()) return;
    await updateDoc(doc(db, "users", editTarget.id), { fullname: editTarget.fullname });
    setEditTarget(null);
    fetchUsers();
  };

  const handleConfirmDelete = async () => {
    await deleteDoc(doc(db, "users", deleteTarget));
    setDeleteTarget(null);
    fetchUsers();
  };

  const handleConfirmPromote = async () => {
    await updateDoc(doc(db, "users", promoteTarget.id), { role: "admin" });
    setPromoteTarget(null);
    fetchUsers();
  };

  const handleConfirmAssistant = async () => {
    await updateDoc(doc(db, "users", assistantTarget.id), { role: "admin assistant" });
    setAssistantTarget(null);
    fetchUsers();
  };

  const filterUsers = (list) =>
    list.filter(
      (u) =>
        u.fullname?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.email?.toLowerCase().includes(searchTerm.toLowerCase())
    );

  if (!loading && !user) return <Navigate to="/login" />;
  if (!loading && user === "unauthorized") return <Navigate to="/" />;

  return (
    <div className="bg-light min-vh-100">
      {/* HEADER */}
      <div className="bg-white border-bottom shadow-sm mb-4">
        <div className="container py-4">
          <div className="row align-items-center">
            <div className="col-md-6">
              <h1 className="fw-bold h3 mb-1">Admin Dashboard</h1>
              <p className="text-muted mb-0">Manage system users and access levels</p>
            </div>
            <div className="col-md-6 mt-3 mt-md-0">
              <div className="input-group shadow-sm rounded">
                <span className="input-group-text bg-white border-end-0">
                  <AiOutlineSearch className="text-muted" />
                </span>
                <input
                  type="text"
                  className="form-control border-start-0 ps-0"
                  placeholder="Search by name or email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container pb-5">
        {loading ? (
          <div className="text-center py-5">
            <div className="spinner-border text-primary mb-3" />
            <p className="text-muted">Loading directory...</p>
          </div>
        ) : (
          <>
            <div className="row g-3 mb-5">
              <StatCard title="Total Students" count={students.length} icon={<AiOutlineUser />} color="primary" />
              <StatCard title="Total Professors" count={professors.length} icon={<AiOutlineIdcard />} color="success" />
              <StatCard title="Admin Assistants" count={assistants.length} icon={<AiOutlineTeam />} color="info" />
            </div>

            <SectionWrapper title="Student Directory">
              <UserTable
                users={filterUsers(students)}
                onSelectUser={(u) => setSelectedUser(u)}
                onEdit={(u) => setEditTarget({ id: u.id, fullname: u.fullname })}
                onDelete={(id) => setDeleteTarget(id)}
              />
            </SectionWrapper>

            <SectionWrapper title="Professor Directory">
              <UserTable
                users={filterUsers(professors)}
                onSelectUser={(u) => setSelectedUser(u)}
                onEdit={(u) => setEditTarget({ id: u.id, fullname: u.fullname })}
                onDelete={(id) => setDeleteTarget(id)}
                onRegister={(u) => setPromoteTarget({ id: u.id, fullname: u.fullname })}
                onAssistant={(u) => setAssistantTarget({ id: u.id, fullname: u.fullname })}
              />
            </SectionWrapper>

            <SectionWrapper title="Admin Assistant Directory">
              <UserTable
                users={filterUsers(assistants)}
                onSelectUser={(u) => setSelectedUser(u)}
                onEdit={(u) => setEditTarget({ id: u.id, fullname: u.fullname })}
                onDelete={(id) => setDeleteTarget(id)}
                onRegister={(u) => setPromoteTarget({ id: u.id, fullname: u.fullname })}
              />
            </SectionWrapper>
          </>
        )}
      </div>

      {/* --- USER DETAILS & ACHIEVEMENTS MODAL --- */}
      {selectedUser && (
        <UserDetailsModal
          targetUser={selectedUser}
          onClose={() => setSelectedUser(null)}
        />
      )}

      {/* --- EDIT MODAL --- */}
      {editTarget && (
        <ModalWrapper title="Edit User Profile" onClose={() => setEditTarget(null)}>
          <div className="mb-3">
            <label className="form-label small fw-bold">Full Name</label>
            <input
              className="form-control"
              value={editTarget.fullname}
              onChange={(e) => setEditTarget({ ...editTarget, fullname: e.target.value })}
              autoFocus
            />
          </div>
          <button className="btn btn-primary w-100" onClick={handleConfirmEdit}>Save Changes</button>
        </ModalWrapper>
      )}

      {/* --- DELETE MODAL --- */}
      {deleteTarget && (
        <ModalWrapper title="Confirm Deletion" onClose={() => setDeleteTarget(null)}>
          <div className="text-center py-3">
            <AiOutlineExclamationCircle className="text-danger display-4 mb-3" />
            <p>Are you sure you want to delete this user? This action is permanent.</p>
          </div>
          <div className="d-flex gap-2">
            <button className="btn btn-danger w-100" onClick={handleConfirmDelete}>Delete User</button>
            <button className="btn btn-light border w-100" onClick={() => setDeleteTarget(null)}>Cancel</button>
          </div>
        </ModalWrapper>
      )}

      {/* --- PROMOTE TO ADMIN MODAL --- */}
      {promoteTarget && (
        <ModalWrapper title="Grant Admin Privileges" onClose={() => setPromoteTarget(null)}>
          <div className="text-center py-3">
            <AiOutlineUserAdd className="text-success display-4 mb-3" />
            <p>Promote <strong>{promoteTarget.fullname}</strong> to Administrator status?</p>
          </div>
          <button className="btn btn-success w-100" onClick={handleConfirmPromote}>Confirm Promotion</button>
        </ModalWrapper>
      )}

      {/* --- MAKE ADMIN ASSISTANT MODAL --- */}
      {assistantTarget && (
        <ModalWrapper title="Assign Admin Assistant Role" onClose={() => setAssistantTarget(null)}>
          <div className="text-center py-3">
            <AiOutlineSolution className="text-info display-4 mb-3" />
            <p>Assign <strong>{assistantTarget.fullname}</strong> as an <strong>Admin Assistant</strong>?</p>
          </div>
          <button className="btn btn-info text-white w-100" onClick={handleConfirmAssistant}>Assign Role</button>
        </ModalWrapper>
      )}
    </div>
  );
}

/* HELPER COMPONENTS */
function StatCard({ title, count, icon, color }) {
  return (
    <div className="col-md-4">
      <div className={`card border-0 border-start border-4 border-${color} shadow-sm rounded-3`}>
        <div className="card-body d-flex align-items-center justify-content-between">
          <div>
            <p className="text-muted small text-uppercase mb-1 fw-bold">{title}</p>
            <h2 className="mb-0 fw-bolder">{count}</h2>
          </div>
          <div className={`h1 mb-0 text-${color} opacity-25`}>{icon}</div>
        </div>
      </div>
    </div>
  );
}

function SectionWrapper({ title, children }) {
  return (
    <div className="card border-0 shadow-sm rounded-4 overflow-hidden mb-5">
      <div className="card-header bg-white py-3 border-bottom">
        <h5 className="mb-0 fw-bold text-dark">{title}</h5>
      </div>
      <div className="card-body p-0">{children}</div>
    </div>
  );
}

function ModalWrapper({ title, children, onClose }) {
  return (
    <div className="modal d-block shadow-lg" style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 1050 }}>
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content border-0 rounded-4">
          <div className="modal-header border-0 pb-0">
            <h6 className="modal-title fw-bold">{title}</h6>
            <button type="button" className="btn-close" onClick={onClose}></button>
          </div>
          <div className="modal-body p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

function UserDetailsModal({ targetUser, onClose }) {
  const avatar = targetUser.profilePicture || targetUser.photoURL || targetUser.avatar || targetUser.imageUrl;
  
  const achievements = targetUser.achievements || [
    { title: "Account Verified", icon: "⭐", desc: "Active system user" },
    { title: "Role Assigned", icon: targetUser.role === "professor" ? "👨‍🏫" : "🎓", desc: `Registered as ${targetUser.role}` },
  ];

  return (
    <div className="modal d-block" style={{ backgroundColor: "rgba(0,0,0,0.6)", zIndex: 1060 }}>
      <div className="modal-dialog modal-dialog-centered modal-lg">
        <div className="modal-content border-0 shadow-lg rounded-4 overflow-hidden">
          
          <div className="modal-header bg-primary text-white border-bottom-0 p-4">
            <div className="d-flex align-items-center gap-3">
              {avatar ? (
                <img 
                  src={avatar} 
                  alt={targetUser.fullname} 
                  className="rounded-circle border border-2 border-white shadow-sm"
                  style={{ width: "56px", height: "56px", objectFit: "cover" }}
                />
              ) : (
                <div 
                  className="rounded-circle bg-white text-primary d-flex align-items-center justify-content-center fw-bold shadow-sm"
                  style={{ width: "56px", height: "56px", fontSize: "1.4rem" }}
                >
                  {(targetUser.fullname || "U").charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <h5 className="modal-title fw-bold mb-0">{targetUser.fullname}</h5>
                <small className="opacity-75">{targetUser.email}</small>
              </div>
            </div>
            <button type="button" className="btn-close btn-close-white" onClick={onClose}></button>
          </div>

          <div className="modal-body p-4 bg-light">
            <div className="row g-3 mb-4">
              <div className="col-sm-6">
                <div className="card border-0 shadow-sm rounded-3 p-3 bg-white">
                  <small className="text-muted fw-bold d-block mb-1">USER ROLE</small>
                  <span className="fw-bold text-uppercase text-primary">{targetUser.role}</span>
                </div>
              </div>
              <div className="col-sm-6">
                <div className="card border-0 shadow-sm rounded-3 p-3 bg-white">
                  <small className="text-muted fw-bold d-block mb-1">ACCOUNT ID</small>
                  <span className="small text-truncate d-block text-secondary">{targetUser.id}</span>
                </div>
              </div>
            </div>

            <div className="card border-0 shadow-sm rounded-4 p-3 bg-white mb-4">
              <div className="d-flex align-items-center gap-2 mb-3">
                <AiOutlineTrophy className="text-warning fs-4" />
                <h6 className="fw-bold text-muted small uppercase mb-0">ACHIEVEMENTS & BADGES</h6>
              </div>
              <div className="row g-2">
                {achievements.map((ach, idx) => (
                  <div key={idx} className="col-sm-6">
                    <div className="p-2 border rounded-3 d-flex align-items-center gap-2 bg-light">
                      <span className="fs-4">{ach.icon}</span>
                      <div>
                        <div className="fw-bold small text-dark">{ach.title}</div>
                        <small className="text-muted d-block" style={{ fontSize: "0.75rem" }}>{ach.desc}</small>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card border-0 shadow-sm rounded-4 p-3 bg-white">
              <div className="d-flex align-items-center gap-2 mb-2">
                <AiOutlineBook className="text-primary fs-4" />
                <h6 className="fw-bold text-muted small uppercase mb-0">ACTIVITY OVERVIEW</h6>
              </div>
              <p className="text-muted small mb-0">
                {targetUser.role === "student" 
                  ? "Student is enrolled and participating in active classes." 
                  : "User has active system permissions according to their role."}
              </p>
            </div>
          </div>

          <div className="modal-footer border-top-0 bg-light pt-0">
            <button className="btn btn-secondary rounded-pill px-4" onClick={onClose}>Close</button>
          </div>

        </div>
      </div>
    </div>
  );
}

function UserTable({ users, onSelectUser, onEdit, onDelete, onRegister, onAssistant }) {
  if (users.length === 0) {
    return (
      <div className="text-center py-5 text-muted small">No records found.</div>
    );
  }

  return (
    <div className="table-responsive">
      <table className="table table-hover align-middle mb-0">
        <thead className="table-light">
          <tr className="small text-uppercase fw-bold">
            <th className="px-4 py-3">Name</th>
            <th className="py-3">Email</th>
            <th className="text-center py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const avatar = u.profilePicture || u.photoURL || u.avatar || u.imageUrl;
            
            return (
              <tr key={u.id}>
                <td className="px-4">
                  <div 
                    className="d-flex align-items-center gap-3" 
                    style={{ cursor: "pointer" }}
                    onClick={() => onSelectUser(u)}
                  >
                    {avatar ? (
                      <img 
                        src={avatar} 
                        alt={u.fullname} 
                        className="rounded-circle border shadow-sm"
                        style={{ width: "36px", height: "36px", objectFit: "cover" }}
                      />
                    ) : (
                      <div 
                        className="rounded-circle bg-light border d-flex align-items-center justify-content-center shadow-sm" 
                        style={{ width: "36px", height: "36px" }}
                      >
                        <span className="small fw-bold text-secondary">{u.fullname?.charAt(0)}</span>
                      </div>
                    )}
                    <div>
                      <span className="fw-semibold text-primary text-decoration-underline-hover d-block">{u.fullname}</span>
                      <small className="text-muted" style={{ fontSize: "0.75rem" }}>Click for details</small>
                    </div>
                  </div>
                </td>
                <td className="text-muted small">{u.email}</td>
                <td className="text-center px-4">
                  <div className="d-flex justify-content-center gap-2">
                    <button className="btn btn-white btn-sm border shadow-sm" onClick={() => onEdit(u)} title="Edit">
                      <AiOutlineEdit className="text-primary" />
                    </button>
                    {onAssistant && (
                      <button className="btn btn-white btn-sm border shadow-sm" onClick={() => onAssistant(u)} title="Make Admin Assistant">
                        <AiOutlineSolution className="text-info" />
                      </button>
                    )}
                    {onRegister && (
                      <button className="btn btn-white btn-sm border shadow-sm" onClick={() => onRegister(u)} title="Make Admin">
                        <AiOutlineUserAdd className="text-success" />
                      </button>
                    )}
                    <button className="btn btn-white btn-sm border shadow-sm" onClick={() => onDelete(u.id)} title="Delete">
                      <AiOutlineDelete className="text-danger" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default Admin;