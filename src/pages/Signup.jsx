import { useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { doc, setDoc, getDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  deleteUser, 
  updatePassword 
} from "firebase/auth";
import emailjs from "@emailjs/browser";
import { db, auth } from "../firebase";

function SignUp() {
  const location = useLocation();
  const navigate = useNavigate();

  // Determine user role from query string
  const queryParams = new URLSearchParams(location.search);
  const role = queryParams.get("role") || "student";

  const title =
    role === "professor"
      ? "Create a Professor Account"
      : "Create a Student Account";

  const [fullname, setFullname] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // Email Verification States
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [pendingUser, setPendingUser] = useState(null);
  const [resendTimer, setResendTimer] = useState(60); // 1 minute resend cooldown
  const [expiryTimer, setExpiryTimer] = useState(300); // 5 minutes expiration limit
  const [canResend, setCanResend] = useState(false);

  // Google Sign-In Confirmation Modal State
  const [showGoogleModal, setShowGoogleModal] = useState(false);
  const [googleUser, setGoogleUser] = useState(null);
  const [googleFullname, setGoogleFullname] = useState("");
  const [googlePassword, setGooglePassword] = useState("");

  // Status Modal State
  const [modal, setModal] = useState({
    show: false,
    title: "",
    message: "",
    type: "success",
  });

  // --- TIMER EFFECT (1-min resend / 5-min expiration) ---
  useEffect(() => {
    let timer;
    if (showVerificationModal) {
      timer = setInterval(() => {
        setResendTimer((prev) => (prev > 0 ? prev - 1 : 0));
        setExpiryTimer((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [showVerificationModal]);

  useEffect(() => {
    if (resendTimer === 0) {
      setCanResend(true);
    }
  }, [resendTimer]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // --- MANUAL EMAIL/PASSWORD REGISTRATION ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    let user = null;
    try {
      // 1. Create or Recover Auth User
      try {
        const userCredential = await createUserWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );
        user = userCredential.user;
      } catch (createErr) {
        if (createErr.code === "auth/email-already-in-use") {
          // Email exists. Check if it's an unverified account from an interrupted session.
          try {
            const loginCredential = await signInWithEmailAndPassword(
              auth, 
              email.trim(), 
              password
            );
            const userDoc = await getDoc(doc(db, "users", loginCredential.user.uid));
            
            if (!userDoc.exists()) {
              // User is in Auth but not in Firestore. Reuse this account.
              user = loginCredential.user;
            } else {
              // Fully registered user, throw the original error
              throw createErr;
            }
          } catch (loginErr) {
            // Sign-in failed (e.g., wrong password), throw the original error
            throw createErr;
          }
        } else {
          throw createErr;
        }
      }

      setPendingUser(user);

      // 2. Generate 6-digit OTP code & 5-minute expiration
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = Date.now() + 5 * 60 * 1000; 

      // Store OTP in Firestore temporarily
      await setDoc(doc(db, "emailVerifications", user.uid), {
        otp,
        expiresAt,
      });

      // 3. Send real email using EmailJS client-side SDK
      await emailjs.send(
        "service_ig1o3lc",
        "template_u8yct0p",
        {
          to_email: email.trim(),
          email: email.trim(),
          user_email: email.trim(),
          to_name: fullname.trim(),
          otp: otp,
          code: otp,
          verification_code: otp,
        },
        "9OoNzw8NVQIi9DxX_"
      );

      // 4. Trigger Verification Modal & Reset Timers
      setResendTimer(60);
      setExpiryTimer(300);
      setCanResend(false);
      setVerificationCode("");
      setShowVerificationModal(true);
    } catch (err) {
      console.error("Sign up error:", err);

      if (user) {
        try {
          await deleteUser(user);
        } catch (delErr) {
          console.error("Error cleaning up user after failed sign up:", delErr);
        }
      }
      await signOut(auth);
      setPendingUser(null);

      let message = "Failed to create account. Please try again.";
      if (err.code === "auth/email-already-in-use") {
        message = "Email already in use. Try logging in.";
      } else if (err.code === "auth/invalid-email") {
        message = "Invalid email format.";
      } else if (err.code === "auth/weak-password") {
        message = "Password should be at least 6 characters.";
      } else if (err.text || err.message) {
        message = `Email error: ${err.text || err.message}`;
      }

      setModal({
        show: true,
        title: "Registration Failed",
        message: message,
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  // --- HANDLE VERIFY CODE SUBMISSION ---
  const handleVerifyCode = async (e) => {
    e.preventDefault();
    if (!pendingUser) return;

    setLoading(true);
    try {
      const verificationDocRef = doc(db, "emailVerifications", pendingUser.uid);
      const verificationSnap = await getDoc(verificationDocRef);

      if (!verificationSnap.exists()) {
        throw new Error("Verification session expired. Please request a new code.");
      }

      const { otp, expiresAt } = verificationSnap.data();

      if (Date.now() > expiresAt || expiryTimer === 0) {
        throw new Error("Verification code has expired. Please click Resend Code.");
      }

      if (verificationCode.trim() !== otp) {
        throw new Error("Incorrect verification code. Please try again.");
      }

      // If registered via Google and provided a password, update the Auth password for manual login support
      if (googleUser && googlePassword) {
        await updatePassword(pendingUser, googlePassword);
      }

      const finalFullname = fullname.trim() || googleFullname.trim();

      // Create final user profile in Firestore
      await setDoc(doc(db, "users", pendingUser.uid), {
        fullname: finalFullname,
        email: pendingUser.email,
        role: role,
        createdAt: serverTimestamp(),
      });

      await deleteDoc(verificationDocRef);

      setShowVerificationModal(false);
      setModal({
        show: true,
        title: "Success!",
        message: "Email verified successfully! Your account has been created.",
        type: "success",
      });
    } catch (err) {
      console.error("Verification error:", err);
      setModal({
        show: true,
        title: "Verification Failed",
        message: err.message || "Invalid verification code.",
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  // --- HANDLE RESEND CODE ---
  const handleResendCode = async () => {
    if (!pendingUser || !canResend) return;

    setLoading(true);
    try {
      const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = Date.now() + 5 * 60 * 1000;

      await setDoc(doc(db, "emailVerifications", pendingUser.uid), {
        otp: newOtp,
        expiresAt,
      });

      const targetEmail = pendingUser.email;
      const targetName = fullname.trim() || googleFullname.trim();

      await emailjs.send(
        "service_ig1o3lc",
        "template_u8yct0p",
        {
          to_email: targetEmail,
          email: targetEmail,
          user_email: targetEmail,
          to_name: targetName,
          otp: newOtp,
          code: newOtp,
          verification_code: newOtp,
        },
        "9OoNzw8NVQIi9DxX_"
      );

      setResendTimer(60);
      setExpiryTimer(300);
      setCanResend(false);
      setVerificationCode("");

      setModal({
        show: true,
        title: "Code Resent",
        message: "A new verification code has been sent to your email.",
        type: "success",
      });
    } catch (err) {
      console.error("Resend error:", err);
      setModal({
        show: true,
        title: "Error",
        message: "Failed to resend code. Please try again.",
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  // --- CANCEL VERIFICATION (Cleanup user if abandoned) ---
  const handleCancelVerification = async () => {
    if (pendingUser) {
      try {
        await deleteDoc(doc(db, "emailVerifications", pendingUser.uid));
        await deleteUser(pendingUser);
        await signOut(auth);
      } catch (err) {
        console.error("Error cleaning up unverified user:", err);
      }
    }
    setShowVerificationModal(false);
    setPendingUser(null);
    setGoogleUser(null);
    setGooglePassword("");
  };

  // --- GOOGLE SIGN-IN HANDLER ---
  const handleGoogleSignUp = async () => {
    const provider = new GoogleAuthProvider();

    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        await signOut(auth);
        setModal({
          show: true,
          title: "Account Exists",
          message: "An account with this Google email already exists. Please log in instead.",
          type: "error",
        });
        return;
      }

      setGoogleUser(user);
      setGoogleFullname(user.displayName || "");
      setGooglePassword("");
      setShowGoogleModal(true);
    } catch (err) {
      if (err.code !== "auth/popup-closed-by-user") {
        console.error("Google Sign-Up Error:", err);
        setModal({
          show: true,
          title: "Google Authentication Failed",
          message: "Unable to sign in with Google. Please try again.",
          type: "error",
        });
      }
    }
  };

  // --- CONFIRM GOOGLE PROFILE & TRIGGER OTP ---
  const handleConfirmGoogleSignUp = async (e) => {
    e.preventDefault();
    if (!googleUser || !googleFullname.trim() || googlePassword.length < 6) {
      setModal({
        show: true,
        title: "Validation Error",
        message: "Please enter your full name and a password of at least 6 characters.",
        type: "error",
      });
      return;
    }

    setLoading(true);
    try {
      setPendingUser(googleUser);

      // Generate 6-digit OTP code & 5-minute expiration
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = Date.now() + 5 * 60 * 1000;

      // Store OTP in Firestore temporarily
      await setDoc(doc(db, "emailVerifications", googleUser.uid), {
        otp,
        expiresAt,
      });

      // Send real email using EmailJS client-side SDK
      await emailjs.send(
        "service_ig1o3lc",
        "template_u8yct0p",
        {
          to_email: googleUser.email,
          email: googleUser.email,
          user_email: googleUser.email,
          to_name: googleFullname.trim(),
          otp: otp,
          code: otp,
          verification_code: otp,
        },
        "9OoNzw8NVQIi9DxX_"
      );

      setShowGoogleModal(false);
      setResendTimer(60);
      setExpiryTimer(300);
      setCanResend(false);
      setVerificationCode("");
      setShowVerificationModal(true);
    } catch (err) {
      console.error("Google OTP sign up error:", err);

      if (googleUser) {
        try {
          await deleteUser(googleUser);
        } catch (delErr) {
          console.error("Error cleaning up google user after failed sign up:", delErr);
        }
      }
      await signOut(auth);
      setPendingUser(null);
      setShowGoogleModal(false);

      setModal({
        show: true,
        title: "Registration Failed",
        message: `Email error: ${err.text || err.message || "Failed to send verification code."}`,
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCloseModal = () => {
    const isSuccess = modal.type === "success";
    setModal({ ...modal, show: false });
    if (isSuccess && !showVerificationModal) {
      if (role === "professor") {
        navigate("/classes");
      } else {
        navigate("/preferences");
      }
    }
  };

  return (
    <>
      <section className="bg-light py-5 border-bottom">
        <div className="container text-center py-4">
          <h1 className="fw-bold display-5 text-dark">{title}</h1>
          <p className="lead text-muted mt-3">
            Fill in your details below to set up your SkillPath account.
          </p>
        </div>
      </section>

      <section className="py-5">
        <div className="container d-flex justify-content-center">
          <div
            className="card shadow-sm rounded-4 w-100 border-0"
            style={{ maxWidth: "500px" }}
          >
            <div className="card-body p-5">
              <button
                type="button"
                onClick={handleGoogleSignUp}
                className="btn btn-outline-light border text-dark fw-bold w-100 d-flex align-items-center justify-content-center py-3 mb-4 shadow-sm"
              >
                <img
                  src="https://cdn-icons-png.flaticon.com/128/300/300221.png"
                  alt="Google"
                  className="me-2"
                  style={{ width: "20px" }}
                />
                Continue with Google
              </button>

              <div className="d-flex align-items-center my-3">
                <hr className="flex-grow-1" />
                <span className="mx-3 text-muted small fw-bold">OR</span>
                <hr className="flex-grow-1" />
              </div>

              <form onSubmit={handleSubmit}>
                <div className="mb-3">
                  <label htmlFor="fullname" className="form-label fw-bold small text-muted text-uppercase">
                    Full Name
                  </label>
                  <input
                    type="text"
                    className="form-control form-control-lg bg-light border-0"
                    id="fullname"
                    placeholder="Enter your full name"
                    value={fullname}
                    onChange={(e) => setFullname(e.target.value)}
                    required
                  />
                </div>

                <div className="mb-3">
                  <label htmlFor="email" className="form-label fw-bold small text-muted text-uppercase">
                    Email Address
                  </label>
                  <input
                    type="email"
                    className="form-control form-control-lg bg-light border-0"
                    id="email"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="mb-3">
                  <label htmlFor="password" className="form-label fw-bold small text-muted text-uppercase">
                    Password
                  </label>
                  <input
                    type="password"
                    className="form-control form-control-lg bg-light border-0"
                    id="password"
                    placeholder="Minimum 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>

                <div className="d-grid mt-4">
                  <button
                    type="submit"
                    className="btn btn-primary btn-lg fw-bold shadow-sm py-3"
                    disabled={loading}
                  >
                    {loading ? (
                      <span className="spinner-border spinner-border-sm me-2"></span>
                    ) : null}
                    {loading ? "Sending Email Code..." : "Create Account"}
                  </button>
                </div>
              </form>

              <p className="text-center text-muted small mt-4">
                Already have an account?{" "}
                <a href="/login" className="text-decoration-none fw-bold">
                  Login here
                </a>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* EMAIL VERIFICATION MODAL */}
      {showVerificationModal && (
        <div className="modal d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 1065 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-0 shadow-lg rounded-4 p-3">
              <form onSubmit={handleVerifyCode}>
                <div className="modal-header border-0 pb-0">
                  <h5 className="fw-bold m-0 text-dark">Verify Your Email</h5>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={handleCancelVerification}
                  ></button>
                </div>
                <div className="modal-body">
                  <p className="text-muted small mb-3">
                    We've sent a 6-digit verification code to <span className="fw-bold text-dark">{pendingUser?.email}</span>. Please check your inbox. Code expires in <span className="text-danger fw-bold">{formatTime(expiryTimer)}</span>.
                  </p>

                  <div className="mb-3">
                    <label className="form-label fw-bold small text-muted text-uppercase">Verification Code</label>
                    <input
                      type="text"
                      maxLength="6"
                      className="form-control form-control-lg bg-light border-0 text-center fw-bold"
                      placeholder="123456"
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value)}
                      required
                    />
                  </div>

                  <div className="d-flex justify-content-between align-items-center mt-3">
                    <span className="text-muted small">Didn't receive code?</span>
                    <button
                      type="button"
                      className="btn btn-link p-0 text-decoration-none fw-bold small"
                      onClick={handleResendCode}
                      disabled={!canResend || loading}
                    >
                      {canResend ? "Resend Code" : `Resend in ${formatTime(resendTimer)}`}
                    </button>
                  </div>
                </div>
                <div className="modal-footer border-0 pt-0 pb-3">
                  <button
                    type="button"
                    className="btn btn-light px-4 rounded-pill fw-bold"
                    onClick={handleCancelVerification}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary px-4 rounded-pill fw-bold"
                    disabled={loading || verificationCode.length < 6 || expiryTimer === 0}
                  >
                    {loading ? <span className="spinner-border spinner-border-sm me-2"></span> : null}
                    Verify & Complete
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* GOOGLE PROFILE DETAILS MODAL */}
      {showGoogleModal && (
        <div className="modal d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-0 shadow-lg rounded-4">
              <form onSubmit={handleConfirmGoogleSignUp}>
                <div className="modal-header border-0 pt-4 px-4 pb-0 d-flex justify-content-between align-items-center">
                  <h5 className="fw-bold m-0">Complete Your Profile</h5>
                  <span className={`badge ${role === "professor" ? "bg-warning text-dark" : "bg-primary"} px-3 py-2 rounded-pill text-uppercase fs-6`}>
                    {role} Account
                  </span>
                </div>
                <div className="modal-body p-4">
                  <p className="text-muted small mb-4">
                    Confirm your details and set a password below to send a verification code to your Google email.
                  </p>

                  <div className="mb-3">
                    <label className="form-label fw-bold small text-muted text-uppercase">Google Email</label>
                    <input
                      type="email"
                      className="form-control bg-light border-0 py-2 text-muted"
                      value={googleUser?.email || ""}
                      readOnly
                      disabled
                    />
                  </div>

                  <div className="mb-3">
                    <label className="form-label fw-bold small text-muted text-uppercase">Full Name</label>
                    <input
                      type="text"
                      className="form-control bg-light border-0 py-2"
                      placeholder="Enter your full name"
                      value={googleFullname}
                      onChange={(e) => setGoogleFullname(e.target.value)}
                      required
                    />
                  </div>

                  <div className="mb-3">
                    <label className="form-label fw-bold small text-muted text-uppercase">Password</label>
                    <input
                      type="password"
                      className="form-control bg-light border-0 py-2"
                      placeholder="Minimum 6 characters for manual login"
                      value={googlePassword}
                      onChange={(e) => setGooglePassword(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="modal-footer border-0 pb-4 px-4">
                  <button
                    type="button"
                    className="btn btn-light px-4 rounded-pill fw-bold"
                    onClick={async () => {
                      if (googleUser) {
                        try {
                          await deleteUser(googleUser);
                        } catch (err) {
                          console.error("Cleanup error:", err);
                        }
                      }
                      signOut(auth);
                      setShowGoogleModal(false);
                      setGoogleUser(null);
                      setGooglePassword("");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary px-4 rounded-pill fw-bold"
                    disabled={loading}
                  >
                    {loading ? <span className="spinner-border spinner-border-sm me-2"></span> : null}
                    {loading ? "Sending Code..." : "Continue & Verify"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

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
                  {modal.type === "error" ? "Try Again" : "Continue"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default SignUp;