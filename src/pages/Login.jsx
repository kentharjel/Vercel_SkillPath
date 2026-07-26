import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { 
  signInWithEmailAndPassword, 
  signInWithPopup, 
  GoogleAuthProvider, 
  sendPasswordResetEmail,
  signOut
} from "firebase/auth";
import { auth, db } from "../firebase";
import { doc, getDoc } from "firebase/firestore";

// React Icons for eye toggle
import { AiOutlineEye, AiOutlineEyeInvisible } from "react-icons/ai";

function Login() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  
  // Forgot Password States
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  // Status Modal State
  const [modal, setModal] = useState({
    show: false,
    title: "",
    message: "",
    type: "success", // "success", "error", or "loading"
    onClose: null
  });

  // Check LocalStorage for Remembered User
  useEffect(() => {
    const savedEmail = localStorage.getItem("skillpath_email");
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
  }, []);

  // ROLE-BASED ROUTING HANDLER
  const handleRoleRouting = (role) => {
    switch (role) {
      case "admin":
        navigate("/admin");
        break;
      case "admin assistant":
      case "admin_assistant":
        navigate("/requests");
        break;
      case "student":
        navigate("/progress");
        break;
      case "professor":
        navigate("/classes");
        break;
      default:
        navigate("/profile");
        break;
    }
  };

  const handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    setModal({
      show: true,
      title: "Google Sign-In",
      message: "Opening Google authentication window...",
      type: "loading",
      onClose: () => setModal((prev) => ({ ...prev, show: false }))
    });

    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      const userSnap = await getDoc(doc(db, "users", user.uid));

      // IF USER DOES NOT EXIST IN FIRESTORE, DO NOT CREATE AN ACCOUNT
      if (!userSnap.exists()) {
        await signOut(auth); // Immediately terminate session
        setModal({
          show: true,
          title: "Account Not Found",
          message: "No registered SkillPath account exists for this Google email. Please register or sign up first.",
          type: "error",
          onClose: null
        });
        return;
      }

      const userRole = userSnap.data().role || "student";

      setModal({
        show: true,
        title: "Welcome Back!",
        message: `Successfully logged in as ${user.displayName || "User"}.`,
        type: "success",
        onClose: () => handleRoleRouting(userRole)
      });

      setTimeout(() => handleRoleRouting(userRole), 1500);
    } catch (error) {
      if (error.code === "auth/popup-closed-by-user") {
        setModal((prev) => ({ ...prev, show: false }));
      } else {
        setModal({
          show: true,
          title: "Sign-In Error",
          message: "Could not authenticate with Google.",
          type: "error",
          onClose: null
        });
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
      
      if (rememberMe) {
        localStorage.setItem("skillpath_email", email.trim());
      } else {
        localStorage.removeItem("skillpath_email");
      }

      const currentUser = userCredential.user;
      const snap = await getDoc(doc(db, "users", currentUser.uid));
      const role = snap.exists() ? snap.data().role : "student";

      setModal({
        show: true,
        title: "Welcome Back!",
        message: "Logged in successfully.",
        type: "success",
        onClose: () => handleRoleRouting(role)
      });

      setTimeout(() => handleRoleRouting(role), 1500);
    } catch (error) {
      let message = "Incorrect email or password. Please try again.";
      if (error.code === "auth/too-many-requests") message = "Too many attempts. Try again later.";
      
      setModal({
        show: true,
        title: "Login Error",
        message: message,
        type: "error",
        onClose: null
      });
    } finally {
      setLoading(false);
    }
  };

  // FULLY FUNCTIONAL FORGOT PASSWORD LOGIC
  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!resetEmail) return;
    setResetLoading(true);

    try {
      await sendPasswordResetEmail(auth, resetEmail.trim());
      
      setShowForgotModal(false);
      
      setModal({
        show: true,
        title: "Email Sent Successfully!",
        message: `A password reset link has been sent to ${resetEmail}. Please check your inbox and spam folder.`,
        type: "success",
        onClose: null
      });
    } catch (error) {
      console.error("Forgot Password Error:", error.code);
      let msg = "We couldn't send the reset email. Please try again.";
      
      if (error.code === "auth/user-not-found") {
        msg = "No account found with this email address.";
      } else if (error.code === "auth/invalid-email") {
        msg = "The email address is badly formatted.";
      }

      setModal({
        show: true,
        title: "Reset Failed",
        message: msg,
        type: "error",
        onClose: null
      });
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="d-flex justify-content-center align-items-center" style={{ minHeight: "80vh", backgroundColor: "#f4f6f9" }}>
      <div className="card shadow-lg p-4 rounded-4 border-0" style={{ maxWidth: "400px", width: "100%" }}>
        <div className="text-center mb-4">
          <h2 className="fw-bold text-primary">SkillPath</h2>
          <p className="text-muted small">Login to your account</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label className="form-label fw-bold small text-muted text-uppercase">Email</label>
            <input
              type="email"
              className="form-control form-control-lg bg-light border-0"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="mb-3">
            <label className="form-label fw-bold small text-muted text-uppercase">Password</label>
            <div className="input-group">
              <input
                type={showPassword ? "text" : "password"}
                className="form-control form-control-lg bg-light border-0"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="btn btn-light border-0 d-flex align-items-center justify-content-center"
                onClick={() => setShowPassword(!showPassword)}
                style={{ width: "45px" }}
              >
                {showPassword ? <AiOutlineEyeInvisible size={20} /> : <AiOutlineEye size={20} />}
              </button>
            </div>
          </div>

          <div className="mb-3 d-flex justify-content-between align-items-center">
            <div className="form-check">
              <input 
                className="form-check-input" 
                type="checkbox" 
                id="rememberMe" 
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <label className="form-check-label small" htmlFor="rememberMe">Remember Me</label>
            </div>
            <button 
              type="button"
              className="btn btn-link p-0 small text-primary text-decoration-none fw-bold"
              onClick={() => {
                setResetEmail(email);
                setShowForgotModal(true);
              }}
            >
              Forgot Password?
            </button>
          </div>

          <button type="submit" className="btn btn-primary w-100 fw-bold py-3 shadow-sm" disabled={loading}>
            {loading ? <span className="spinner-border spinner-border-sm"></span> : "Login"}
          </button>
        </form>

        <div className="text-center my-3 text-muted small">OR</div>

        <div className="d-grid gap-2">
          <button type="button" onClick={handleGoogleLogin} className="btn btn-outline-light border text-dark fw-bold d-flex align-items-center justify-content-center py-2">
            <img src="https://cdn-icons-png.flaticon.com/128/300/300221.png" alt="Google" className="me-2" style={{ width: "18px" }} />
            Continue with Google
          </button>
        </div>

        <p className="text-center text-muted small mt-4">
          Don’t have an account? <a href="/getstarted" className="text-primary fw-bold text-decoration-none">Sign Up</a>
        </p>
      </div>

      {/* FORGOT PASSWORD INPUT MODAL */}
      {showForgotModal && (
        <div className="modal d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-0 shadow-lg rounded-4">
              <form onSubmit={handleForgotPassword}>
                <div className="modal-header border-0 pt-4 px-4 pb-0">
                  <h5 className="fw-bold">Reset Password</h5>
                </div>
                <div className="modal-body p-4">
                  <p className="text-muted small">Enter your email and we'll send you a link to reset your password.</p>
                  <input
                    type="email"
                    className="form-control bg-light border-0 py-2"
                    placeholder="Enter your email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="modal-footer border-0 pb-4 px-4">
                  <button type="button" className="btn btn-light px-4 rounded-pill fw-bold" onClick={() => setShowForgotModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary px-4 rounded-pill fw-bold" disabled={resetLoading}>
                    {resetLoading ? <span className="spinner-border spinner-border-sm me-2"></span> : null}
                    {resetLoading ? "Sending..." : "Send Link"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* GLOBAL STATUS MODAL */}
      {modal.show && (
        <div className="modal d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 1070 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-0 shadow-lg rounded-4 text-center">
              <div className="modal-header border-0 pt-4 px-4 pb-0 justify-content-center">
                <h5 className={`fw-bold ${modal.type === "error" ? "text-danger" : modal.type === "loading" ? "text-primary" : "text-success"}`}>
                  {modal.title}
                </h5>
              </div>
              <div className="modal-body p-4">
                {modal.type === "loading" && <div className="spinner-border text-primary mb-3"></div>}
                <p className="text-muted mb-0">{modal.message}</p>
              </div>
              <div className="modal-footer border-0 pb-4 px-4">
                <button 
                  className={`btn ${modal.type === "error" ? "btn-danger" : modal.type === "loading" ? "btn-light" : "btn-primary"} px-5 rounded-pill fw-bold w-100`} 
                  onClick={() => {
                    if (modal.onClose) modal.onClose();
                    setModal((prev) => ({ ...prev, show: false }));
                  }}
                >
                  {modal.type === "error" ? "Try Again" : modal.type === "loading" ? "Cancel" : "Continue"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Login;