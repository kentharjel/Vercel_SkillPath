import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";
import { doc, getDoc, addDoc, collection, serverTimestamp, query, where, getDocs, updateDoc } from "firebase/firestore";

function TakeQuiz() {
  const location = useLocation();
  const navigate = useNavigate();
  const { classId, contentId } = location.state || {};

  const [quiz, setQuiz] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [alreadyAttempted, setAlreadyAttempted] = useState(false);
  const [previousScore, setPreviousScore] = useState(null);

  // Quiz Interaction State
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [isFinished, setIsFinished] = useState(false);
  const [score, setScore] = useState(0); 

  // AI Explanation State
  const [explanations, setExplanations] = useState({});
  const [loadingExplanation, setLoadingExplanation] = useState(false);

  // Admin Edit State
  const [editTitle, setEditTitle] = useState("");
  const [editQuestions, setEditQuestions] = useState([]);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (!currentUser) return navigate("/login");
      
      const userDoc = await getDoc(doc(db, "users", currentUser.uid));
      const userData = { uid: currentUser.uid, ...userDoc.data() };
      setUser(userData);

      if (classId && contentId) {
        const quizSnap = await getDoc(doc(db, `classes/${classId}/content`, contentId));
        if (quizSnap.exists()) {
          const data = quizSnap.data();
          setQuiz(data);
          setEditTitle(data.title || "");
          setEditQuestions(data.questions || []);

          if (userData.role === "student") {
            const attemptsRef = collection(db, `classes/${classId}/attempts`);
            const q = query(attemptsRef, 
              where("studentId", "==", currentUser.uid), 
              where("quizId", "==", contentId)
            );
            const attemptSnaps = await getDocs(q);
            
            if (!attemptSnaps.empty) {
              const attemptData = attemptSnaps.docs[0].data();
              setPreviousScore(attemptData.score);
              setAlreadyAttempted(true);
            }
          }
        }
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [classId, contentId, navigate]);

  // --- PROFESSOR LOGIC ---
  const handleUpdateQuiz = async () => {
    try {
      await updateDoc(doc(db, `classes/${classId}/content`, contentId), {
        title: editTitle,
        questions: editQuestions
      });
      setQuiz({ ...quiz, title: editTitle, questions: editQuestions });
      setShowSuccessModal(true);
    } catch (err) {
      console.error(err);
    }
  };

  const updateQuestionText = (index, val) => {
    const updated = [...editQuestions];
    updated[index].questionText = val;
    setEditQuestions(updated);
  };

  const updateOptionText = (qIdx, oIdx, val) => {
    const updated = [...editQuestions];
    updated[qIdx].options[oIdx] = val;
    setEditQuestions(updated);
  };

  const updateCorrectAnswer = (qIdx, oIdx) => {
    const updated = [...editQuestions];
    updated[qIdx].correctAnswer = oIdx;
    setEditQuestions(updated);
  };

  // --- STUDENT LOGIC ---
  const fetchAiExplanation = async (questionObj, selectedIdx) => {
    setLoadingExplanation(true);
    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey) {
        setExplanations(prev => ({
          ...prev,
          [currentQuestion]: `Correct Answer: ${questionObj.options[questionObj.correctAnswer]}`
        }));
        setLoadingExplanation(false);
        return;
      }

      const prompt = `You are an educational assistant. A student answered a multiple-choice question.
      Question: "${questionObj.questionText}"
      Options: ${JSON.stringify(questionObj.options)}
      Correct Answer Index: ${questionObj.correctAnswer} (${questionObj.options[questionObj.correctAnswer]})
      Student's Answer Index: ${selectedIdx} (${questionObj.options[selectedIdx]})

      Provide a concise, clear explanation (1-2 sentences) of why the correct answer is right.`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });

      if (!response.ok) throw new Error("Failed to fetch explanation");
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "No explanation provided.";

      setExplanations(prev => ({
        ...prev,
        [currentQuestion]: text.trim()
      }));
    } catch (err) {
      console.error("AI Explanation Error:", err);
      setExplanations(prev => ({
        ...prev,
        [currentQuestion]: `The correct answer is: ${questionObj.options[questionObj.correctAnswer]}`
      }));
    } finally {
      setLoadingExplanation(false);
    }
  };

  const handleSelectOption = (idx) => {
    if (selectedAnswers[currentQuestion] !== undefined) return; // Prevent changing after selection
    
    const updatedAnswers = { ...selectedAnswers, [currentQuestion]: idx };
    setSelectedAnswers(updatedAnswers);

    const q = quiz.questions[currentQuestion];
    fetchAiExplanation(q, idx);
  };

  const handleNext = () => {
    if (currentQuestion < quiz.questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
    } else {
      calculateResult();
    }
  };

  const calculateResult = async () => {
    let totalCorrect = 0;
    quiz.questions.forEach((q, index) => {
      if (selectedAnswers[index] === q.correctAnswer) totalCorrect++;
    });

    const percentageScore = Math.round((totalCorrect / quiz.questions.length) * 100);
    setScore(totalCorrect); 
    setIsFinished(true);

    await addDoc(collection(db, `classes/${classId}/attempts`), {
      studentId: user.uid,
      studentName: user.fullname || "Student",
      quizId: contentId,
      quizTitle: quiz.title,
      score: percentageScore,
      completedAt: serverTimestamp(),
    });
  };

  if (loading) return <div className="text-center py-5">Loading...</div>;

  // --- RENDER: PROFESSOR VIEW ---
  if (user?.role === "professor") {
    return (
      <div className="container py-5">
        <div className="d-flex justify-content-between align-items-center mb-4">
          <div>
            <label className="small fw-bold text-muted">QUIZ TITLE</label>
            <input 
              className="form-control form-control-lg fw-bold border-0 bg-light" 
              value={editTitle} 
              onChange={(e) => setEditTitle(e.target.value)}
            />
          </div>
          <button className="btn btn-outline-secondary rounded-pill" onClick={() => navigate(-1)}>Back</button>
        </div>

        {editQuestions.map((q, qIdx) => (
          <div key={qIdx} className="card p-4 mb-4 border-0 shadow-sm rounded-4">
            <div className="mb-3">
              <label className="small fw-bold text-primary">QUESTION {qIdx + 1}</label>
              <input 
                className="form-control fw-bold" 
                value={q.questionText} 
                onChange={(e) => updateQuestionText(qIdx, e.target.value)}
              />
            </div>
            
            <div className="row g-3">
              {q.options.map((opt, oIdx) => (
                <div key={oIdx} className="col-md-6">
                  <div className={`input-group rounded-3 overflow-hidden border ${q.correctAnswer === oIdx ? 'border-success shadow-sm' : ''}`}>
                    <div className="input-group-text bg-white border-0">
                      <input 
                        type="radio" 
                        className="form-check-input" 
                        name={`correct-${qIdx}`} 
                        checked={q.correctAnswer === oIdx} 
                        onChange={() => updateCorrectAnswer(qIdx, oIdx)}
                      />
                    </div>
                    <input 
                      className={`form-control border-0 ${q.correctAnswer === oIdx ? 'bg-success-subtle fw-bold' : ''}`} 
                      value={opt} 
                      onChange={(e) => updateOptionText(qIdx, oIdx, e.target.value)}
                    />
                    {q.correctAnswer === oIdx && <span className="input-group-text bg-success-subtle border-0">✅</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="sticky-bottom bg-white py-3 border-top mt-5">
          <button className="btn btn-primary w-100 py-3 rounded-pill fw-bold shadow" onClick={handleUpdateQuiz}>
            Save All Quiz Changes
          </button>
        </div>

        {showSuccessModal && (
          <div className="modal d-block" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content border-0 shadow-lg rounded-4 text-center p-5">
                <div className="display-1 text-success mb-3">🎉</div>
                <h3 className="fw-bold">Updated!</h3>
                <p className="text-muted">Quiz content and answers have been saved successfully.</p>
                <button 
                  className="btn btn-primary rounded-pill px-5 mt-3 fw-bold" 
                  onClick={() => setShowSuccessModal(false)}
                >
                  Great!
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- RENDER: STUDENT VIEW (LOCKED) ---
  if (alreadyAttempted && !isFinished) {
    const totalQuestions = quiz?.questions?.length || 0;
    const rawPreviousScore = Math.round((previousScore / 100) * totalQuestions);

    return (
      <div className="container py-5 text-center">
        <div className="card border-0 shadow-lg p-5 rounded-4 mx-auto" style={{ maxWidth: "500px" }}>
          <div className="display-1 mb-4">✅</div>
          <h2 className="fw-bold">Quiz Already Done</h2>
          <p className="text-muted mt-3">
            You have already submitted your answers for <strong>{quiz?.title}</strong>. 
            Your recorded score is:
          </p>
          <div className="display-4 fw-bold text-primary mb-3">{rawPreviousScore} / {totalQuestions}</div>
          <p className="small text-muted mb-4">Retakes are not allowed for this assessment.</p>
          <button className="btn btn-primary rounded-pill px-5" onClick={() => navigate(-1)}>Return to Class</button>
        </div>
      </div>
    );
  }

  // --- RENDER: STUDENT VIEW (RESULT SCREEN) ---
  if (isFinished) {
    const totalQuestions = quiz?.questions?.length || 0;
    return (
      <div className="container py-5 text-center">
        <div className="card border-0 shadow-lg p-5 rounded-4 mx-auto" style={{ maxWidth: "500px" }}>
          <div className="display-4 mb-3">{score === totalQuestions ? "🌟 Perfect!" : "✅ Submitted"}</div>
          <h2 className="fw-bold">{score} / {totalQuestions}</h2>
          <p className="text-muted">Your score has been successfully recorded.</p>
          <button className="btn btn-primary mt-4 px-5 rounded-pill" onClick={() => navigate(-1)}>Finish</button>
        </div>
      </div>
    );
  }

  // --- RENDER: STUDENT VIEW (TAKING QUIZ) ---
  const q = quiz.questions[currentQuestion];
  const answered = selectedAnswers[currentQuestion] !== undefined;

  return (
    <div className="container py-5">
      <div className="progress mb-4" style={{ height: "10px" }}>
        <div className="progress-bar" style={{ width: `${((currentQuestion + 1) / quiz.questions.length) * 100}%` }}></div>
      </div>
      <div className="card border-0 shadow-sm p-4 p-md-5 rounded-4">
        <h3 className="fw-bold mb-4">{q.questionText}</h3>
        <div className="d-flex flex-column gap-3">
          {q.options.map((opt, idx) => {
            const isSelected = selectedAnswers[currentQuestion] === idx;
            const isCorrect = idx === q.correctAnswer;

            let btnStyle = "btn-outline-light text-dark border-light-subtle";
            if (answered) {
              if (isCorrect) {
                btnStyle = "btn-success text-white fw-bold border-success";
              } else if (isSelected && !isCorrect) {
                btnStyle = "btn-danger text-white fw-bold border-danger";
              } else {
                btnStyle = "btn-outline-secondary text-muted opacity-50";
              }
            }

            return (
              <button 
                key={idx} 
                disabled={answered}
                className={`btn btn-lg text-start p-3 rounded-4 border-2 ${btnStyle}`}
                onClick={() => handleSelectOption(idx)}
              >
                {opt} {answered && isCorrect && " ✅"} {answered && isSelected && !isCorrect && " ❌"}
              </button>
            );
          })}
        </div>

        {/* AI EXPLANATION BOX */}
        {answered && (
          <div className="mt-4 p-4 rounded-4 bg-light border border-primary-subtle shadow-sm animate-fade-in">
            <h6 className="fw-bold text-primary mb-2">💡 Explanation (Gemini 3.5 Flash-Lite)</h6>
            {loadingExplanation ? (
              <p className="text-muted mb-0 small">Generating explanation...</p>
            ) : (
              <p className="text-dark mb-0">{explanations[currentQuestion] || "Loading explanation..."}</p>
            )}
          </div>
        )}

        <button 
          className="btn btn-primary mt-5 py-3 rounded-pill fw-bold" 
          disabled={!answered}
          onClick={handleNext}
        >
          {currentQuestion === quiz.questions.length - 1 ? "Submit Quiz" : "Next Question"}
        </button>
      </div>
    </div>
  );
}

export default TakeQuiz;