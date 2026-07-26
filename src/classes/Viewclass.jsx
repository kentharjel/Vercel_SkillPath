import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";
import { supabase } from "../supabase"; 
import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  addDoc,
  deleteDoc,
  serverTimestamp,
  orderBy
} from "firebase/firestore";

function ViewClass() {
  const location = useLocation();
  const navigate = useNavigate();
  const classId = location.state?.classId;

  const [user, setUser] = useState(null);
  const [classData, setClassData] = useState(null);
  const [classContent, setClassContent] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [studentAttempts, setStudentAttempts] = useState([]);
  const [allQuizScores, setAllQuizScores] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");

  // Modal State for Student Details / Achievements / Progress
  const [selectedStudent, setSelectedStudent] = useState(null);

  const [showLessonModal, setShowLessonModal] = useState(false);
  const [newLesson, setNewLesson] = useState({ title: "", content: "", links: [], attachments: [] });
  const [linkInput, setLinkInput] = useState({ title: "", url: "" });
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadingFile, setUploadingFile] = useState(false);

  const [showQuizModal, setShowQuizModal] = useState(false);
  const [quizTitle, setQuizTitle] = useState("");
  const [questions, setQuestions] = useState([
    { questionText: "", options: ["", "", "", ""], correctAnswer: 0 }
  ]);

  // AI Quiz Generator States
  const [showAiQuizModal, setShowAiQuizModal] = useState(false);
  const [aiQuizTitle, setAiQuizTitle] = useState("");
  const [aiSourceType, setAiSourceType] = useState("lesson"); // "lesson" or "custom"
  const [selectedLessonId, setSelectedLessonId] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [aiFiles, setAiFiles] = useState([]);
  const [aiDifficulty, setAiDifficulty] = useState("Medium");
  const [aiNumQuestions, setAiNumQuestions] = useState(5);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [aiSuccessModal, setAiSuccessModal] = useState(false);

  // Modal for lesson/quiz deletion
  const [deleteModal, setDeleteModal] = useState({ show: false, id: null, title: "", attachments: [] });

  const getLinkIcon = (url) => {
    try {
      const domain = new URL(url).hostname;
      return (
        <img 
          src={`https://www.google.com/s2/favicons?sz=64&domain=${domain}`} 
          alt="icon" 
          style={{ width: '18px', height: '18px', objectFit: 'contain', borderRadius: '3px' }} 
        />
      );
    } catch (e) {
      return <span>🔗</span>;
    }
  };

  const getStoragePath = (file) => {
    if (file.path) return file.path;
    if (!file.url) return null;

    try {
      const urlObj = new URL(file.url);
      const pathSegments = urlObj.pathname.split("/class_files/");
      if (pathSegments.length > 1) {
        return decodeURIComponent(pathSegments[1]);
      }
    } catch (e) {
      console.error("Invalid file URL:", file.url);
    }
    return null;
  };

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (!currentUser) return navigate("/login");
      const userDoc = await getDoc(doc(db, "users", currentUser.uid));
      const userData = { uid: currentUser.uid, ...userDoc.data() };
      setUser(userData);
      fetchClassDetails(userData);
    });
    return () => unsubscribe();
  }, [classId, navigate]);

  const fetchClassDetails = async (userData) => {
    if (!classId) return navigate("/classes");
    try {
      const classSnap = await getDoc(doc(db, "classes", classId));
      if (!classSnap.exists()) return navigate("/classes");
      setClassData({ id: classSnap.id, ...classSnap.data() });

      const contentSnap = await getDocs(
        query(collection(db, `classes/${classId}/content`), orderBy("createdAt", "asc"))
      );
      setClassContent(contentSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      if (userData.role === "student") {
        const attemptsSnap = await getDocs(
          query(
            collection(db, `classes/${classId}/attempts`), 
            where("studentId", "==", userData.uid)
          )
        );
        const attemptedQuizIds = attemptsSnap.docs.map(doc => doc.data().quizId);
        setStudentAttempts(attemptedQuizIds);
      }

      if (userData.role === "professor") {
        const cData = classSnap.data();
        if (cData.students?.length > 0) {
          const sSnap = await getDocs(query(collection(db, "users"), where("__name__", "in", cData.students)));
          setStudents(sSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        }
        
        const allAttemptsSnap = await getDocs(
          query(collection(db, `classes/${classId}/attempts`), orderBy("completedAt", "desc"))
        );
        setAllQuizScores(allAttemptsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      }
    } catch (err) { 
      console.error(err); 
    } finally { 
      setLoading(false); 
    }
  };

  const confirmDelete = async () => {
    try {
      if (deleteModal.attachments && deleteModal.attachments.length > 0) {
        const filePaths = deleteModal.attachments
          .map(getStoragePath)
          .filter(Boolean);

        if (filePaths.length > 0) {
          await supabase.storage.from("class_files").remove(filePaths);
        }
      }

      await deleteDoc(doc(db, `classes/${classId}/content`, deleteModal.id));
      setClassContent(classContent.filter(item => item.id !== deleteModal.id));
      setDeleteModal({ show: false, id: null, title: "", attachments: [] });
    } catch (err) {
      console.error("Error deleting item:", err);
    }
  };

  const addLinkToLesson = () => {
    if (!linkInput.title || !linkInput.url) return;
    setNewLesson({ ...newLesson, links: [...(newLesson.links || []), linkInput] });
    setLinkInput({ title: "", url: "" });
  };

  const removeLinkFromLesson = (idx) => {
    setNewLesson({ ...newLesson, links: newLesson.links.filter((_, i) => i !== idx) });
  };

  const handleFileSelection = (e) => {
    if (e.target.files) {
      setSelectedFiles(Array.from(e.target.files));
    }
  };

  const handleAddLesson = async (e) => {
    e.preventDefault();
    setUploadingFile(true);

    try {
      const uploadedAttachments = [];

      for (const file of selectedFiles) {
        const fileExt = file.name.split(".").pop();
        const filePath = `class_files/${classId}/${Date.now()}_${file.name}`;

        const { error: uploadError } = await supabase.storage
          .from("class_files")
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
          .from("class_files")
          .getPublicUrl(filePath);

        uploadedAttachments.push({
          name: file.name,
          url: publicUrlData.publicUrl,
          path: filePath,
          type: file.type,
          ext: fileExt
        });
      }

      await addDoc(collection(db, `classes/${classId}/content`), {
        ...newLesson,
        attachments: uploadedAttachments,
        type: "lesson",
        createdAt: serverTimestamp()
      });

      setShowLessonModal(false);
      setNewLesson({ title: "", content: "", links: [], attachments: [] });
      setSelectedFiles([]);
      fetchClassDetails(user);
    } catch (err) {
      console.error("Failed to post lesson:", err);
    } finally {
      setUploadingFile(false);
    }
  };

  const addQuestionField = () => {
    setQuestions([...questions, { questionText: "", options: ["", "", "", ""], correctAnswer: 0 }]);
  };

  const removeQuestion = (index) => {
    if (questions.length > 1) {
      setQuestions(questions.filter((_, i) => i !== index));
    }
  };

  const updateQuestion = (index, field, value) => {
    const newQuestions = [...questions];
    newQuestions[index][field] = value;
    setQuestions(newQuestions);
  };

  const updateOption = (qIndex, oIndex, value) => {
    const newQuestions = [...questions];
    newQuestions[qIndex].options[oIndex] = value;
    setQuestions(newQuestions);
  };

  const handleAddQuiz = async (e) => {
    e.preventDefault();
    await addDoc(collection(db, `classes/${classId}/content`), {
      title: quizTitle,
      questions: questions,
      type: "quiz",
      createdAt: serverTimestamp()
    });
    setQuizTitle("");
    setQuestions([{ questionText: "", options: ["", "", "", ""], correctAnswer: 0 }]);
    setShowQuizModal(false);
    fetchClassDetails(user);
  };

  const handleGenerateAiQuiz = async (e) => {
    e.preventDefault();
    setGeneratingAi(true);

    try {
      let sourceText = "";
      let fileParts = [];

      const supportedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

      if (aiSourceType === "lesson") {
        const selectedLesson = classContent.find(c => c.id === selectedLessonId);
        if (!selectedLesson) {
          alert("Please select a valid lesson source.");
          setGeneratingAi(false);
          return;
        }
        sourceText = `Lesson Title: ${selectedLesson.title}\nContent: ${selectedLesson.content || ""}`;
        if (selectedLesson.attachments && selectedLesson.attachments.length > 0) {
          for (const att of selectedLesson.attachments) {
            const isSupported = supportedTypes.includes(att.type) || 
              ['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(att.ext?.toLowerCase());

            if (!isSupported) {
              console.warn(`Skipping unsupported file type for AI processing: ${att.name}`);
              continue;
            }

            try {
              const res = await fetch(att.url);
              const blob = await res.blob();
              const base64Data = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result.split(",")[1]);
                reader.readAsDataURL(blob);
              });
              fileParts.push({
                inlineData: {
                  data: base64Data,
                  mimeType: att.type || "application/octet-stream"
                }
              });
            } catch (err) {
              console.error("Failed to fetch attachment for AI analysis:", err);
            }
          }
        }
      } else {
        sourceText = customPrompt;
        if (aiFiles && aiFiles.length > 0) {
          for (const file of aiFiles) {
            const isSupported = supportedTypes.includes(file.type) || 
              ['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(file.name.split(".").pop()?.toLowerCase());

            if (!isSupported) {
              console.warn(`Skipping unsupported custom file: ${file.name}`);
              continue;
            }

            const base64Data = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result.split(",")[1]);
              reader.readAsDataURL(file);
            });
            fileParts.push({
              inlineData: {
                data: base64Data,
                mimeType: file.type
              }
            });
          }
        }
      }

      const promptPayload = [
        {
          text: `You are an expert AI quiz creator for an educational platform. Based on the provided source material, generate a quiz with exactly ${aiNumQuestions} multiple-choice questions at a ${aiDifficulty} difficulty level.
          
          Return ONLY a valid JSON object in the following format without any markdown code block formatting:
          {
            "quizTitle": "Generated Quiz Title",
            "questions": [
              {
                "questionText": "Question string here?",
                "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
                "correctAnswer": 0
              }
            ]
          }
          where correctAnswer is the zero-based index (0 to 3) of the correct option.
          
          Source Material:
          ${sourceText}`
        },
        ...fileParts
      ];

      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`;

      let response;
      let retries = 3;
      let delay = 2000;

      while (retries > 0) {
        response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: promptPayload }] })
        });

        if (response.status === 429) {
          retries--;
          await new Promise(res => setTimeout(res, delay));
          delay *= 2;
        } else {
          break;
        }
      }

      if (!response.ok) {
        throw new Error(`Gemini API Error: ${response.statusText}`);
      }

      const data = await response.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!rawText) throw new Error("No response received from Gemini API.");

      const cleanedJson = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsedQuiz = JSON.parse(cleanedJson);

      const finalTitle = aiQuizTitle.trim() !== "" ? aiQuizTitle : (parsedQuiz.quizTitle || "AI Generated Quiz");

      await addDoc(collection(db, `classes/${classId}/content`), {
        title: finalTitle,
        questions: parsedQuiz.questions,
        type: "quiz",
        createdAt: serverTimestamp()
      });

      setShowAiQuizModal(false);
      setSelectedLessonId("");
      setCustomPrompt("");
      setAiFiles([]);
      setAiQuizTitle("");
      fetchClassDetails(user);
      setAiSuccessModal(true);
    } catch (err) {
      console.error("AI Quiz Generation Failed:", err);
      alert("Failed to generate AI quiz. Please check your API key or source content and try again.");
    } finally {
      setGeneratingAi(false);
    }
  };

  if (loading || !classData) return <div className="text-center py-5">Loading...</div>;

  return (
    <>
      {/* HEADER SECTION */}
      <section className="bg-light py-5 border-bottom">
        <div className="container d-flex justify-content-between align-items-center">
          <div>
            <h1 className="fw-bold text-dark">{classData.className}</h1>
            <p className="text-muted mb-0">Professor: {classData.professorName}</p>
          </div>
          {user.role === "professor" && (
            <div className="text-end">
              <small className="text-muted d-block fw-bold">CLASS CODE</small>
              <code className="h4 text-primary bg-white px-3 py-1 rounded shadow-sm border">{classData.classCode}</code>
            </div>
          )}
        </div>
      </section>

      {/* MATERIALS SECTION */}
      <section className="py-5">
        <div className="container">
          <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-3">
            <h4 className="fw-bold mb-0">Class Materials</h4>
            {user.role === "professor" && (
              <div className="d-flex gap-2 flex-wrap">
                <button className="btn btn-primary shadow-sm" onClick={() => setShowLessonModal(true)}>+ Add Lesson</button>
                <button className="btn btn-outline-primary shadow-sm" onClick={() => setShowQuizModal(true)}>+ Add Quiz</button>
                <button className="btn btn-dark shadow-sm d-flex align-items-center gap-1" onClick={() => setShowAiQuizModal(true)}>
                  <span>✨</span> AI Quiz Generator
                </button>
              </div>
            )}
          </div>

          <div className="row g-4">
            {classContent.length > 0 ? (
              classContent.map((item) => {
                const isCompleted = item.type === 'quiz' && studentAttempts.includes(item.id);
                
                return (
                  <div key={item.id} className="col-md-6">
                    <div className={`card border-0 shadow-sm rounded-4 h-100 border-start border-4 ${isCompleted ? 'border-success' : 'border-primary'}`}>
                      <div className="card-body p-4">
                        <div className="d-flex justify-content-between align-items-start mb-3">
                          <div className="d-flex gap-2 align-items-center flex-wrap">
                            <span className={`badge px-3 py-2 ${item.type === 'lesson' ? 'bg-info text-white' : 'bg-warning text-dark'}`}>
                              {item.type.toUpperCase()}
                            </span>
                            {isCompleted && (
                              <span className="badge bg-success px-3 py-2">DONE ✅</span>
                            )}
                            {item.attachments?.length > 0 && (
                              <span className="badge bg-secondary px-2 py-1">📎 {item.attachments.length} file(s)</span>
                            )}
                            {item.links?.slice(0, 3).map((l, i) => (
                              <span key={i} className="ms-1">{getLinkIcon(l.url)}</span>
                            ))}
                          </div>

                          {user.role === "professor" && (
                            <div className="dropdown">
                              <button 
                                className="btn btn-link text-muted p-0 text-decoration-none" 
                                type="button" 
                                data-bs-toggle="dropdown" 
                                aria-expanded="false"
                                style={{ fontSize: "1.2rem", lineHeight: "1" }}
                              >
                                &#8942;
                              </button>
                              <ul className="dropdown-menu dropdown-menu-end shadow-sm border-0 rounded-3">
                                <li>
                                  <button 
                                    className="dropdown-item text-danger d-flex align-items-center gap-2 small"
                                    onClick={() => setDeleteModal({ show: true, id: item.id, title: item.title, attachments: item.attachments || [] })}
                                  >
                                    <span>🗑️</span> Delete Lesson
                                  </button>
                                </li>
                              </ul>
                            </div>
                          )}
                        </div>

                        <div className="mb-3">
                          <h5 className={`fw-bold mb-1 ${isCompleted ? 'text-success' : ''}`}>{item.title}</h5>
                          <p className="text-muted small mb-0">
                            {item.type === 'lesson' ? 'Reading & Media Material' : `${item.questions?.length} Questions`}
                          </p>
                        </div>

                        <div className="d-flex justify-content-end mt-4">
                          <button 
                            className={`btn rounded-pill px-4 shadow-sm ${isCompleted ? 'btn-success' : 'btn-primary'}`} 
                            onClick={() => navigate(item.type === 'lesson' ? "/viewlesson" : "/takequiz", { state: { contentId: item.id, classId } })}
                          >
                            {isCompleted ? "View Result" : "Open"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-5 text-muted">No materials posted yet.</div>
            )}
          </div>
        </div>
      </section>

      {/* FOOTER GRADEBOOK VIEW */}
      {user.role === "professor" ? (
        <ProfessorGradebook 
          students={students} 
          scores={allQuizScores} 
          classContent={classContent} 
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          onSelectStudent={(student) => setSelectedStudent(student)}
        />
      ) : null}

      {/* STUDENT DETAILS & ACHIEVEMENTS MODAL */}
      {selectedStudent && (
        <StudentDetailsModal 
          student={selectedStudent} 
          scores={allQuizScores.filter(s => s.studentId === selectedStudent.id)}
          classContent={classContent}
          onClose={() => setSelectedStudent(null)}
        />
      )}

      {/* LESSON DELETE CONFIRMATION MODAL */}
      {deleteModal.show && (
        <div className="modal d-block" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-0 shadow-lg rounded-4">
              <div className="modal-body p-4 text-center">
                <div className="display-4 text-danger mb-3">⚠️</div>
                <h5 className="fw-bold">Delete "{deleteModal.title}"?</h5>
                <p className="text-muted">This action cannot be undone and will permanently delete this material and all attached files from storage.</p>
                <div className="d-flex gap-2 justify-content-center mt-4">
                  <button className="btn btn-light px-4 rounded-pill" onClick={() => setDeleteModal({ show: false, id: null, title: "", attachments: [] })}>Cancel</button>
                  <button className="btn btn-danger px-4 rounded-pill fw-bold" onClick={confirmDelete}>Delete Permanently</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QUIZ MODAL */}
      {showQuizModal && (
        <div className="modal d-block" style={{ backgroundColor: "rgba(0,0,0,0.6)", overflowY: "auto" }}>
          <div className="modal-dialog modal-lg">
            <form className="modal-content border-0 shadow-lg rounded-4" onSubmit={handleAddQuiz}>
              <div className="modal-header border-0 p-4 pb-0">
                <h5 className="fw-bold">Create New Quiz</h5>
              </div>
              <div className="modal-body p-4">
                <div className="mb-4">
                  <label className="form-label small fw-bold text-muted">QUIZ TITLE</label>
                  <input type="text" className="form-control form-control-lg fw-bold" placeholder="e.g. Unit 1 Mastery Check" 
                    onChange={e => setQuizTitle(e.target.value)} required />
                </div>
                {questions.map((q, qIndex) => (
                  <div key={qIndex} className="p-4 border rounded-4 mb-4 bg-white shadow-sm position-relative">
                    <div className="d-flex justify-content-between align-items-center mb-3">
                      <span className="badge bg-secondary-subtle text-secondary px-3">QUESTION {qIndex + 1}</span>
                      {questions.length > 1 && (
                        <button type="button" className="btn btn-link text-danger text-decoration-none p-0 small fw-bold" onClick={() => removeQuestion(qIndex)}>&times; Remove</button>
                      )}
                    </div>
                    <input type="text" className="form-control mb-3" placeholder="What is the question?" 
                      value={q.questionText} onChange={e => updateQuestion(qIndex, 'questionText', e.target.value)} required />
                    <div className="row g-3">
                      {q.options.map((opt, oIndex) => (
                        <div key={oIndex} className="col-md-6">
                          <div className="input-group">
                            <div className="input-group-text bg-white border-end-0">
                              <input type="radio" className="form-check-input" name={`correct-${qIndex}`} checked={q.correctAnswer === oIndex} 
                                onChange={() => updateQuestion(qIndex, 'correctAnswer', oIndex)} />
                            </div>
                            <input type="text" className="form-control border-start-0" placeholder={`Option ${oIndex + 1}`} 
                              value={opt} onChange={e => updateOption(qIndex, oIndex, e.target.value)} required />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <button type="button" className="btn btn-outline-primary w-100 py-2 border-dashed fw-bold" onClick={addQuestionField}>+ Add Another Question</button>
              </div>
              <div className="modal-footer border-0 p-4 pt-0">
                <button type="button" className="btn btn-light px-4" onClick={() => setShowQuizModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary px-5 fw-bold">Save Quiz</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI QUIZ GENERATOR MODAL */}
      {showAiQuizModal && (
        <div className="modal d-block" style={{ backgroundColor: "rgba(0,0,0,0.6)", overflowY: "auto" }}>
          <div className="modal-dialog modal-lg">
            <form className="modal-content border-0 shadow-lg rounded-4" onSubmit={handleGenerateAiQuiz}>
              <div className="modal-header border-0 p-4 pb-0">
                <div className="d-flex align-items-center gap-2">
                  <span className="fs-4">✨</span>
                  <h5 className="fw-bold mb-0">AI Quiz Generator</h5>
                </div>
                <button type="button" className="btn-close" onClick={() => setShowAiQuizModal(false)}></button>
              </div>

              <div className="modal-body p-4">
                <div className="mb-4">
                  <label className="form-label small fw-bold text-muted">QUIZ TITLE (OPTIONAL)</label>
                  <input 
                    type="text" 
                    className="form-control" 
                    placeholder="Leave blank to let AI generate a title based on content" 
                    value={aiQuizTitle}
                    onChange={(e) => setAiQuizTitle(e.target.value)}
                  />
                </div>

                <div className="mb-4">
                  <label className="form-label small fw-bold text-muted">SOURCE MATERIAL</label>
                  <div className="btn-group w-100 mb-3" role="group">
                    <button 
                      type="button" 
                      className={`btn ${aiSourceType === 'lesson' ? 'btn-primary' : 'btn-outline-primary'}`}
                      onClick={() => setAiSourceType('lesson')}
                    >
                      From Existing Lesson
                    </button>
                    <button 
                      type="button" 
                      className={`btn ${aiSourceType === 'custom' ? 'btn-primary' : 'btn-outline-primary'}`}
                      onClick={() => setAiSourceType('custom')}
                    >
                      Custom Text & Files
                    </button>
                  </div>

                  {aiSourceType === 'lesson' ? (
                    <select 
                      className="form-select form-select-lg" 
                      value={selectedLessonId} 
                      onChange={(e) => setSelectedLessonId(e.target.value)}
                      required
                    >
                      <option value="">-- Choose a Lesson --</option>
                      {classContent.filter(c => c.type === 'lesson').map(lesson => (
                        <option key={lesson.id} value={lesson.id}>{lesson.title}</option>
                      ))}
                    </select>
                  ) : (
                    <div>
                      <textarea 
                        className="form-control mb-3" 
                        rows="4" 
                        placeholder="Paste your custom study material, notes, or instructions here..."
                        value={customPrompt}
                        onChange={(e) => setCustomPrompt(e.target.value)}
                        required={aiFiles.length === 0}
                      ></textarea>
                      <label className="form-label small fw-bold text-muted">Attach Reference Files</label>
                      <input 
                        type="file" 
                        multiple 
                        className="form-control"
                        accept="image/*,.pdf,.doc,.docx,.txt"
                        onChange={(e) => setAiFiles(Array.from(e.target.files))}
                      />
                    </div>
                  )}

                  <div className="form-text text-muted small mt-2">
                    ℹ️ <strong>Note:</strong> The AI can only read <strong>PDF documents</strong> and <strong>images (JPEG, PNG, WEBP)</strong>. Other file types will be ignored.
                  </div>
                </div>

                <div className="row g-3 mb-3">
                  <div className="col-md-6">
                    <label className="form-label small fw-bold text-muted">DIFFICULTY LEVEL</label>
                    <select className="form-select" value={aiDifficulty} onChange={(e) => setAiDifficulty(e.target.value)}>
                      <option value="Easy">Easy</option>
                      <option value="Medium">Medium</option>
                      <option value="Hard">Hard</option>
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-bold text-muted">NUMBER OF QUESTIONS</label>
                    <input 
                      type="number" 
                      className="form-control" 
                      min="1" 
                      max="20" 
                      value={aiNumQuestions} 
                      onChange={(e) => setAiNumQuestions(parseInt(e.target.value) || 5)}
                      required 
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer border-0 p-4 pt-0">
                <button type="button" className="btn btn-light px-4 rounded-pill" onClick={() => setShowAiQuizModal(false)} disabled={generatingAi}>Cancel</button>
                <button type="submit" className="btn btn-primary px-5 rounded-pill fw-bold shadow-sm" disabled={generatingAi}>
                  {generatingAi ? "Generating Quiz with AI..." : "✨ Generate Quiz"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI SUCCESS MODAL */}
      {aiSuccessModal && (
        <div className="modal d-block" style={{ backgroundColor: "rgba(0,0,0,0.6)", zIndex: 1070 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-0 shadow-lg rounded-4 text-center p-4">
              <div className="display-3 text-success mb-2">🎉</div>
              <h4 className="fw-bold">Quiz Generated Successfully!</h4>
              <p className="text-muted small mb-4">Your AI-powered quiz has been created and added to the class materials.</p>
              <button className="btn btn-primary rounded-pill px-4 py-2 fw-bold" onClick={() => setAiSuccessModal(false)}>Awesome</button>
            </div>
          </div>
        </div>
      )}

      {/* LESSON MODAL */}
      {showLessonModal && (
        <div className="modal d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
          <div className="modal-dialog modal-lg">
            <form className="modal-content border-0 shadow rounded-4 p-4" onSubmit={handleAddLesson}>
              <h5 className="fw-bold mb-3">Create New Lesson</h5>
              <div className="mb-3">
                <label className="form-label small fw-bold text-muted">TITLE</label>
                <input type="text" className="form-control fw-bold" placeholder="Lesson Name" onChange={e => setNewLesson({...newLesson, title: e.target.value})} required />
              </div>
              <div className="mb-3">
                <label className="form-label small fw-bold text-muted">CONTENT</label>
                <textarea className="form-control" rows="5" placeholder="Lesson details..." onChange={e => setNewLesson({...newLesson, content: e.target.value})} required />
              </div>

              <div className="bg-light p-3 rounded-3 mb-3 border">
                <label className="small fw-bold text-primary mb-2 d-block">
                  UPLOAD DOCUMENTS, PHOTOS & VIDEOS (PDF, DOCX, PPTX, MP4, etc.)
                </label>
                <input 
                  type="file" 
                  multiple 
                  className="form-control mb-2" 
                  accept="image/*,video/*,.pdf,.doc,.docx,.ppt,.pptx"
                  onChange={handleFileSelection}
                />
                {selectedFiles.length > 0 && (
                  <div className="small text-muted">
                    Selected {selectedFiles.length} file(s): {selectedFiles.map(f => f.name).join(", ")}
                  </div>
                )}
              </div>

              <div className="bg-light p-3 rounded-3 mb-3 border">
                <label className="small fw-bold text-primary mb-2">ATTACH EXTERNAL LINKS (Youtube, External Docs)</label>
                <div className="input-group input-group-sm mb-2">
                  <input className="form-control" placeholder="Link Title" value={linkInput.title} onChange={e => setLinkInput({ ...linkInput, title: e.target.value })} />
                  <input className="form-control" placeholder="URL (https://...)" value={linkInput.url} onChange={e => setLinkInput({ ...linkInput, url: e.target.value })} />
                  <button type="button" className="btn btn-dark" onClick={addLinkToLesson}>Add</button>
                </div>
                <div className="d-flex flex-wrap gap-2">
                  {newLesson.links?.map((link, i) => (
                    <span key={i} className="badge bg-white text-dark border p-2 d-flex align-items-center gap-2">
                      {getLinkIcon(link.url)} {link.title}
                      <button type="button" className="btn-close" style={{ fontSize: '8px' }} onClick={() => removeLinkFromLesson(i)}></button>
                    </span>
                  ))}
                </div>
              </div>

              <div className="text-end">
                <button type="button" className="btn btn-light me-2" onClick={() => setShowLessonModal(false)} disabled={uploadingFile}>Cancel</button>
                <button type="submit" className="btn btn-primary px-4 shadow-sm" disabled={uploadingFile}>
                  {uploadingFile ? "Uploading Files..." : "Post Lesson"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function ProfessorGradebook({ students, scores, classContent, searchTerm, setSearchTerm, onSelectStudent }) {
  const quizHeaders = classContent.filter(item => item.type === 'quiz');
  const filteredStudents = students.filter(s => s.fullname?.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <section className="py-5 bg-light">
      <div className="container">
        <div className="d-flex flex-column flex-md-row justify-content-between align-items-md-center mb-4 gap-3">
          <h4 className="fw-bold mb-0">Class Gradebook</h4>
          <div className="position-relative" style={{ maxWidth: "350px", width: "100%" }}>
            <span className="position-absolute top-50 start-0 translate-middle-y ps-3 text-muted">🔍</span>
            <input type="text" className="form-control ps-5 rounded-pill shadow-sm border-0" placeholder="Search student..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>
        </div>
        <div className="card border-0 shadow-sm rounded-4 overflow-hidden">
          <div className="table-responsive">
            <table className="table table-bordered align-middle mb-0">
              <thead className="table-white sticky-top">
                <tr>
                  <th className="p-4 bg-white">Student Name</th>
                  {quizHeaders.map((quiz) => (
                    <th key={quiz.id} className="text-center p-3 bg-white">
                      <div className="small fw-bold text-primary">{quiz.title}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((s) => {
                  const studentAvatar = s.profilePicture || s.photoURL || s.avatar || s.imageUrl;
                  
                  return (
                    <tr key={s.id}>
                      <td className="p-3">
                        <div 
                          className="d-flex align-items-center gap-3" 
                          style={{ cursor: "pointer" }}
                          onClick={() => onSelectStudent(s)}
                        >
                          {studentAvatar ? (
                            <img 
                              src={studentAvatar} 
                              alt={s.fullname} 
                              className="rounded-circle border shadow-sm"
                              style={{ width: "38px", height: "38px", objectFit: "cover" }}
                            />
                          ) : (
                            <div 
                              className="rounded-circle bg-primary text-white d-flex align-items-center justify-content-center fw-bold shadow-sm"
                              style={{ width: "38px", height: "38px", fontSize: "0.9rem" }}
                            >
                              {(s.fullname || "S").charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <div className="fw-bold text-primary">{s.fullname}</div>
                            <small className="text-muted d-block" style={{ fontSize: "0.75rem" }}>Click for details</small>
                          </div>
                        </div>
                      </td>
                      {quizHeaders.map((quiz) => {
                        const attempt = scores.find(a => a.studentId === s.id && a.quizId === quiz.id);
                        const totalQuestions = quiz.questions?.length || 0;
                        const rawScore = attempt ? Math.round((attempt.score / 100) * totalQuestions) : 0;
                        
                        return (
                          <td key={quiz.id} className="text-center p-3">
                            {attempt ? (
                              <span className="fw-bold text-dark">
                                {rawScore} / {totalQuestions}
                              </span>
                            ) : (
                              <span className="text-muted opacity-50">---</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function StudentDetailsModal({ student, scores, classContent, onClose }) {
  const quizzes = classContent.filter(c => c.type === 'quiz');
  const studentAvatar = student?.profilePicture || student?.photoURL || student?.avatar || student?.imageUrl;
  
  const completedCount = scores.length;
  const totalQuizzes = quizzes.length;
  const progressPercentage = totalQuizzes > 0 ? Math.round((completedCount / totalQuizzes) * 100) : 0;

  const achievements = student?.achievements || [
    { title: "Class Enrollee", icon: "🎓", desc: "Joined the class" },
    ...(completedCount > 0 ? [{ title: "First Quiz Completed", icon: "🚀", desc: "Finished 1st assessment" }] : []),
    ...(progressPercentage === 100 ? [{ title: "Class Champion", icon: "🏆", desc: "Completed all quizzes" }] : []),
  ];

  return (
    <div className="modal d-block" style={{ backgroundColor: "rgba(0,0,0,0.6)", zIndex: 1060 }}>
      <div className="modal-dialog modal-dialog-centered modal-lg">
        <div className="modal-content border-0 shadow-lg rounded-4 overflow-hidden">
          
          <div className="modal-header bg-primary text-white border-bottom-0 p-4">
            <div className="d-flex align-items-center gap-3">
              {studentAvatar ? (
                <img 
                  src={studentAvatar} 
                  alt={student.fullname} 
                  className="rounded-circle border border-2 border-white shadow-sm"
                  style={{ width: "56px", height: "56px", objectFit: "cover" }}
                />
              ) : (
                <div 
                  className="rounded-circle bg-white text-primary d-flex align-items-center justify-content-center fw-bold shadow-sm"
                  style={{ width: "56px", height: "56px", fontSize: "1.4rem" }}
                >
                  {(student.fullname || "S").charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <h5 className="modal-title fw-bold mb-0">{student.fullname}</h5>
                <small className="opacity-75">{student.email || "Student Account"}</small>
              </div>
            </div>
            <button type="button" className="btn-close btn-close-white" onClick={onClose}></button>
          </div>

          <div className="modal-body p-4 bg-light">
            <div className="card border-0 shadow-sm rounded-4 p-3 bg-white mb-4">
              <h6 className="fw-bold text-muted small mb-2">📊 CLASS PROGRESS</h6>
              <div className="d-flex align-items-center justify-content-between mb-2">
                <span className="fw-bold fs-5 text-dark">{progressPercentage}% Completed</span>
                <span className="small text-muted">{completedCount} of {totalQuizzes} Quizzes Done</span>
              </div>
              <div className="progress rounded-pill" style={{ height: "10px" }}>
                <div 
                  className="progress-bar bg-primary rounded-pill" 
                  role="progressbar" 
                  style={{ width: `${progressPercentage}%` }}
                ></div>
              </div>
            </div>

            <div className="card border-0 shadow-sm rounded-4 p-3 bg-white mb-4">
              <h6 className="fw-bold text-muted small mb-3">🏅 ACHIEVEMENTS</h6>
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
              <h6 className="fw-bold text-muted small mb-3">📝 QUIZ SCORES BREAKDOWN</h6>
              {quizzes.length > 0 ? (
                <div className="table-responsive">
                  <table className="table table-sm table-borderless align-middle mb-0">
                    <thead>
                      <tr className="border-bottom">
                        <th className="text-muted small">Quiz Title</th>
                        <th className="text-center text-muted small">Score</th>
                        <th className="text-end text-muted small">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quizzes.map((quiz) => {
                        const attempt = scores.find(a => a.quizId === quiz.id);
                        const totalQ = quiz.questions?.length || 0;
                        const rawScore = attempt ? Math.round((attempt.score / 100) * totalQ) : 0;

                        return (
                          <tr key={quiz.id} className="border-bottom">
                            <td className="fw-bold text-dark py-2">{quiz.title}</td>
                            <td className="text-center fw-bold text-primary">{attempt ? `${rawScore} / ${totalQ}` : "---"}</td>
                            <td className="text-end">
                              {attempt ? <span className="badge bg-success-subtle text-success">Passed</span> : <span className="badge bg-secondary-subtle text-muted">Pending</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-muted small text-center py-2">No quizzes available.</div>
              )}
            </div>

          </div>
          <div className="modal-footer border-0 p-3 bg-white">
            <button type="button" className="btn btn-secondary rounded-pill px-4" onClick={onClose}>Close</button>
          </div>

        </div>
      </div>
    </div>
  );
}

export default ViewClass;