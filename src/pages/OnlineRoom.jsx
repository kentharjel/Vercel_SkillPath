import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import AgoraRTC from "agora-rtc-sdk-ng";
import { auth, db } from "../firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  deleteDoc,
  onSnapshot,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";

const APP_ID = import.meta.env.VITE_AGORA_APP_ID;

function OnlineRoom() {
  const { channelName } = useParams();
  const navigate = useNavigate();

  const clientRef = useRef(null);
  const screenClientRef = useRef(null);
  const localTracksRef = useRef({ audioTrack: null, videoTrack: null });
  const localScreenTracksRef = useRef({ screenVideoTrack: null, screenAudioTrack: null });
  const maximizedContainerRef = useRef(null);
  const maximizedVideoRef = useRef(null);
  const controlsTimeoutRef = useRef(null);
  const localVideoRef = useRef(null);
  const chatScrollRef = useRef(null);

  const [remoteUsers, setRemoteUsers] = useState([]);
  const [remoteScreenShares, setRemoteScreenShares] = useState([]);
  const [micActive, setMicActive] = useState(true);
  const [camActive, setCamActive] = useState(true);
  const [joined, setJoined] = useState(false);
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  
  // Active speaker indicator state
  const [activeSpeakers, setActiveSpeakers] = useState({});

  // Real local user profile state from Firebase
  const [userProfile, setUserProfile] = useState({
    fullname: "Loading...",
    photoURL: null,
    role: "student",
  });

  const [isCreatorOrProf, setIsCreatorOrProf] = useState(false);
  const [classDocId, setClassDocId] = useState(null);
  const [showEndedModal, setShowEndedModal] = useState(false);

  // Room participants snapshot map to reliably match Firebase UIDs with Agora UIDs
  const [roomParticipantsMap, setRoomParticipantsMap] = useState({});

  // Zoom-like Chatroom & 3-Dots Menu States
  const [showChat, setShowChat] = useState(false);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [selectedRecipientUid, setSelectedRecipientUid] = useState("everyone");
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const prevMessagesLengthRef = useRef(0);

  // Screen Share Permission State ("ask_first" | "can_share" | "not_permitted")
  const [screenSharePermission, setScreenSharePermission] = useState("ask_first");
  const [screenShareRequests, setScreenShareRequests] = useState({});
  const [isWaitingForApproval, setIsWaitingForApproval] = useState(false);

  // Raise Hand & Reaction States
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [handRaises, setHandRaises] = useState({});
  const [floatingNotifications, setFloatingNotifications] = useState([]);
  const lastSignalIdRef = useRef(null);

  // Screen Share Maximize & View States
  const [maximizedScreenId, setMaximizedScreenId] = useState(null);
  const [maximizedOrientation, setMaximizedOrientation] = useState("landscape");
  const [showMaximizedControls, setShowMaximizedControls] = useState(true);
  const [activeScreenControlsId, setActiveScreenControlsId] = useState(null);
  const [hoveredScreenId, setHoveredScreenId] = useState(null);

  // Track physical screen orientation for rotation fallback
  const [isPhysicalPortrait, setIsPhysicalPortrait] = useState(
    typeof window !== "undefined" ? window.innerHeight > window.innerWidth : false
  );

  // Modals replacing browser native confirm and alert
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [modalErrorMessage, setModalErrorMessage] = useState("");
  const [showScreenShareRequestModal, setShowScreenShareRequestModal] = useState(false);

  // Device settings states
  const [playbackDevices, setPlaybackDevices] = useState([]);
  const [microphones, setMicrophones] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [activePlaybackId, setActivePlaybackId] = useState("");
  const [activeMicId, setActiveMicId] = useState("");
  const [activeCamId, setActiveCamId] = useState("");
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Connection and error states
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [errorMessage, setErrorMessage] = useState(null);

  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // Handle Autoplay restrictions across browsers safely
  useEffect(() => {
    const handleAutoplayFailed = () => {
      console.warn("Audio autoplay was blocked. Touch/click anywhere on the screen to unblock audio.");
      
      const unlockAudio = async () => {
        if (clientRef.current && clientRef.current.remoteUsers) {
          clientRef.current.remoteUsers.forEach((user) => {
            if (user.audioTrack) user.audioTrack.play();
          });
        }
        if (screenClientRef.current && screenClientRef.current.remoteUsers) {
          screenClientRef.current.remoteUsers.forEach((user) => {
            if (user.audioTrack) user.audioTrack.play();
          });
        }
        document.removeEventListener("click", unlockAudio);
        document.removeEventListener("touchstart", unlockAudio);
      };

      document.addEventListener("click", unlockAudio, { once: true });
      document.addEventListener("touchstart", unlockAudio, { once: true });
    };

    if (typeof AgoraRTC.onAudioAutoplayFailed === "function") {
      AgoraRTC.onAudioAutoplayFailed(handleAutoplayFailed);
    }
  }, []);

  const isWaitingForApprovalRef = useRef(isWaitingForApproval);
  useEffect(() => {
    isWaitingForApprovalRef.current = isWaitingForApproval;
  }, [isWaitingForApproval]);

  const isCreatorOrProfRef = useRef(isCreatorOrProf);
  useEffect(() => {
    isCreatorOrProfRef.current = isCreatorOrProf;
  }, [isCreatorOrProf]);

  const triggerFloatingNotification = useCallback((signal) => {
    const id = Date.now() + Math.random();
    setFloatingNotifications((prev) => [...prev, { ...signal, uniqueKey: id }]);

    setTimeout(() => {
      setFloatingNotifications((prev) => prev.filter((n) => n.uniqueKey !== id));
    }, 3500);
  }, []);

  const resetControlsTimeout = useCallback(() => {
    setShowMaximizedControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      setShowMaximizedControls(false);
    }, 3000);
  }, []);

  useEffect(() => {
    if (maximizedScreenId) {
      resetControlsTimeout();
    } else {
      setShowMaximizedControls(true);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    }
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [maximizedScreenId, resetControlsTimeout]);

  useEffect(() => {
    const handleResize = () => {
      setIsPhysicalPortrait(window.innerHeight > window.innerWidth);
    };
    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, []);

  const localVideoCallbackRef = useCallback((node) => {
    localVideoRef.current = node;
    const { videoTrack } = localTracksRef.current;
    if (node && videoTrack) {
      videoTrack.play(node);
    }
  }, []);

  useEffect(() => {
    if (maximizedScreenId && !isMobile) {
      const elem = maximizedContainerRef.current;
      if (elem && elem.requestFullscreen) {
        elem.requestFullscreen().catch((err) => {
          console.error("Error attempting to enable full-screen mode:", err);
        });
      }
    } else if (!maximizedScreenId && !isMobile) {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch((err) => {
          console.error("Error attempting to exit full-screen mode:", err);
        });
      }
    }
  }, [maximizedScreenId, isMobile]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && !isMobile) {
        setMaximizedScreenId(null);
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [isMobile]);

  const closeMaximizedView = useCallback(() => {
    setMaximizedScreenId(null);
    setShowMaximizedControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    if (isMobile) {
      if (window.screen && window.screen.orientation && window.screen.orientation.unlock) {
        try {
          window.screen.orientation.unlock();
        } catch (e) {}
      }
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
  }, [isMobile]);

  const toggleMaximizedOrientation = async () => {
    const nextOrientation = maximizedOrientation === "landscape" ? "portrait" : "landscape";
    setMaximizedOrientation(nextOrientation);

    if (isMobile) {
      try {
        if (nextOrientation === "landscape") {
          const container = maximizedContainerRef.current;
          if (container && container.requestFullscreen) {
            await container.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
          } else if (container && container.webkitRequestFullscreen) {
            await container.webkitRequestFullscreen().catch(() => {});
          }

          if (window.screen && window.screen.orientation && window.screen.orientation.lock) {
            await window.screen.orientation.lock("landscape").catch((err) => {
              console.log("Native screen lock not supported or denied:", err);
            });
          }
        } else {
          if (window.screen && window.screen.orientation && window.screen.orientation.unlock) {
            window.screen.orientation.unlock();
          }
          if (document.fullscreenElement && document.exitFullscreen) {
            await document.exitFullscreen().catch(() => {});
          }
        }
      } catch (err) {
        console.error("Error toggling orientation lock:", err);
      }
    }
  };

  const stopScreenShare = useCallback(async () => {
    const { screenVideoTrack, screenAudioTrack } = localScreenTracksRef.current;
    if (screenVideoTrack) {
      screenVideoTrack.stop();
      screenVideoTrack.close();
    }
    if (screenAudioTrack) {
      screenAudioTrack.stop();
      screenAudioTrack.close();
    }
    localScreenTracksRef.current = { screenVideoTrack: null, screenAudioTrack: null };

    if (screenClientRef.current) {
      try {
        await screenClientRef.current.unpublish();
      } catch (e) {
        console.error("Error unpublishing screen tracks:", e);
      }
    }
    setIsSharingScreen(false);
  }, []);

  const startScreenShare = useCallback(async () => {
    try {
      const screenClient = screenClientRef.current;
      if (!screenClient) return;

      const screenTracks = await AgoraRTC.createScreenVideoTrack(
        {
          encoderConfig: {
            width: 1920,
            height: 1080,
            frameRate: 60,
            bitrateMax: 3000,
          },
          optimizationMode: "motion",
        },
        "enable"
      );

      let screenVideoTrack = null;
      let screenAudioTrack = null;

      if (Array.isArray(screenTracks)) {
        screenVideoTrack = screenTracks[0];
        screenAudioTrack = screenTracks[1] || null;
      } else {
        screenVideoTrack = screenTracks;
      }

      localScreenTracksRef.current = { screenVideoTrack, screenAudioTrack };

      if (screenVideoTrack) {
        screenVideoTrack.on("track-ended", () => {
          stopScreenShare();
        });
      }

      if (screenAudioTrack) {
        screenAudioTrack.on("track-ended", () => {
          stopScreenShare();
        });
      }

      const tracksToPublish = [];
      if (screenVideoTrack) tracksToPublish.push(screenVideoTrack);
      if (screenAudioTrack) tracksToPublish.push(screenAudioTrack);

      if (tracksToPublish.length > 0) {
        await screenClient.publish(tracksToPublish);
      }

      setIsSharingScreen(true);
      setShowScreenShareRequestModal(false);
      setIsWaitingForApproval(false);
    } catch (err) {
      console.error("Error starting screen share:", err);
      setModalErrorMessage("Could not start screen sharing or system audio. Permission might have been denied.");
      setShowErrorModal(true);
      setIsWaitingForApproval(false);
    }
  }, [stopScreenShare]);

  const allScreenShares = [];
  if (isSharingScreen && localScreenTracksRef.current.screenVideoTrack) {
    allScreenShares.push({
      id: "local-screen",
      uid: clientRef.current?.uid || "local",
      videoTrack: localScreenTracksRef.current.screenVideoTrack,
      fullname: userProfile.fullname,
      isLocal: true,
      isProf: isCreatorOrProf,
    });
  }
  remoteScreenShares.forEach((screen) => {
    const matchingUser = remoteUsers.find((u) => String(u.uid) === String(screen.uid));
    const isProf = matchingUser ? (matchingUser.role === "professor" || matchingUser.role === "admin") : false;
    allScreenShares.push({
      id: `remote-screen-${screen.uid}`,
      uid: screen.uid,
      videoTrack: screen.videoTrack,
      fullname: screen.fullname,
      isLocal: false,
      isProf: isProf,
    });
  });

  useEffect(() => {
    if (maximizedScreenId) {
      const targetScreen = allScreenShares.find((s) => s.id === maximizedScreenId);
      if (!targetScreen) {
        closeMaximizedView();
      } else if (targetScreen.videoTrack && maximizedVideoRef.current) {
        try {
          targetScreen.videoTrack.play(maximizedVideoRef.current);
        } catch (err) {
          console.error("Error playing maximized video track:", err);
        }
      }
    }
  }, [maximizedScreenId, allScreenShares, maximizedOrientation, closeMaximizedView]);

  // Real-time listener for Room Participants mapping
  useEffect(() => {
    if (!channelName) return;
    const q = query(collection(db, "roomParticipants"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const map = {};
      snapshot.forEach((docSnap) => {
        map[docSnap.id] = docSnap.data();
      });
      setRoomParticipantsMap(map);
    });
    return () => unsubscribe();
  }, [channelName]);

  // Fetch user profile and listen for live session updates
  useEffect(() => {
    let isMounted = true;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser && isMounted) {
        try {
          const userDocRef = doc(db, "users", currentUser.uid);
          const userSnap = await getDoc(userDocRef);

          let fullname = currentUser.displayName || "User";
          let photoURL = currentUser.photoURL || null;
          let role = "student";

          if (userSnap.exists()) {
            const userData = userSnap.data();
            if (userData.fullname) fullname = userData.fullname;
            if (userData.photoURL) photoURL = userData.photoURL;
            if (userData.role) role = userData.role;
          }

          setUserProfile({ fullname, photoURL, role });
        } catch (error) {
          console.error("Error fetching user profile data:", error);
          if (isMounted) {
            setUserProfile({
              fullname: currentUser.displayName || "User",
              photoURL: currentUser.photoURL || null,
              role: "student",
            });
          }
        }
      } else if (isMounted) {
        setUserProfile({ fullname: "Guest User", photoURL: null, role: "student" });
      }
    });

    const q = query(collection(db, "live_classes"), where("code", "==", channelName));
    const unsubscribeClass = onSnapshot(q, async (querySnapshot) => {
      if (!isMounted) return;

      if (querySnapshot.empty) {
        setShowEndedModal(true);
      } else {
        const classDoc = querySnapshot.docs[0];
        setClassDocId(classDoc.id);
        const classData = classDoc.data();

        if (classData.screenSharePermission) {
          setScreenSharePermission(classData.screenSharePermission);
        }

        if (classData.handRaises) {
          setHandRaises(classData.handRaises);
          const currentUser = auth.currentUser;
          if (currentUser) {
            setIsHandRaised(!!classData.handRaises[currentUser.uid]);
          }
        }

        if (classData.lastSignal) {
          if (classData.lastSignal.id !== lastSignalIdRef.current) {
            lastSignalIdRef.current = classData.lastSignal.id;
            triggerFloatingNotification(classData.lastSignal);
          }
        }

        if (classData.screenShareRequests) {
          setScreenShareRequests(classData.screenShareRequests);

          const currentUser = auth.currentUser;
          if (currentUser && !isCreatorOrProfRef.current) {
            const myReq = classData.screenShareRequests[currentUser.uid];
            if (myReq && isWaitingForApprovalRef.current) {
              if (myReq.status === "approved") {
                setIsWaitingForApproval(false);
                startScreenShare();
                updateDoc(doc(db, "live_classes", classDoc.id), {
                  [`screenShareRequests.${currentUser.uid}`]: null,
                }).catch(console.error);
              } else if (myReq.status === "rejected") {
                setIsWaitingForApproval(false);
                setModalErrorMessage("Your screen share request was denied by the professor.");
                setShowErrorModal(true);
                updateDoc(doc(db, "live_classes", classDoc.id), {
                  [`screenShareRequests.${currentUser.uid}`]: null,
                }).catch(console.error);
              }
            }
          }
        }

        const currentUser = auth.currentUser;
        if (currentUser) {
          const userDocRef = doc(db, "users", currentUser.uid);
          const userSnap = await getDoc(userDocRef);
          let role = "student";
          if (userSnap.exists() && userSnap.data().role) {
            role = userSnap.data().role;
          }
          if (role === "professor" || role === "admin" || classData.createdBy === currentUser.uid) {
            setIsCreatorOrProf(true);
          }
        }
      }
    });

    return () => {
      isMounted = false;
      unsubscribeAuth();
      unsubscribeClass();
    };
  }, [channelName, startScreenShare, triggerFloatingNotification]);

  // Firestore Chatroom Listener with Unread Counter
  useEffect(() => {
    if (!channelName) return;
    const q = query(
      collection(db, "roomMessages"),
      where("channelName", "==", channelName)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = [];
      snapshot.forEach((docSnap) => {
        msgs.push({ id: docSnap.id, ...docSnap.data() });
      });
      msgs.sort((a, b) => {
        const timeA = a.timestamp?.toMillis ? a.timestamp.toMillis() : (a.timestamp || 0);
        const timeB = b.timestamp?.toMillis ? b.timestamp.toMillis() : (b.timestamp || 0);
        return timeA - timeB;
      });

      if (msgs.length > prevMessagesLengthRef.current) {
        const latestMsg = msgs[msgs.length - 1];
        const currentUid = auth.currentUser?.uid;
        const currentAgoraUid = clientRef.current?.uid;

        if (latestMsg.senderUid !== currentUid) {
          const isVisibleToMe =
            !latestMsg.recipientUid ||
            latestMsg.recipientUid === currentUid ||
            (currentAgoraUid && String(latestMsg.recipientUid) === String(currentAgoraUid));
          if (isVisibleToMe && !showChat) {
            setUnreadChatCount((prev) => prev + 1);
          }
        }
      }
      prevMessagesLengthRef.current = msgs.length;
      setMessages(msgs);
    });
    return () => unsubscribe();
  }, [channelName, showChat]);

  // Reset unread chat count when chat panel is opened
  useEffect(() => {
    if (showChat) {
      setUnreadChatCount(0);
      if (chatScrollRef.current) {
        chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
      }
      setIsUserScrolledUp(false);
    }
  }, [showChat]);

  // Auto scroll when at bottom or new messages arrive
  useEffect(() => {
    if (showChat && chatScrollRef.current && !isUserScrolledUp) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, showChat, isUserScrolledUp]);

  const handleChatScroll = () => {
    if (chatScrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = chatScrollRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
      setIsUserScrolledUp(!isAtBottom);
    }
  };

  const scrollToBottomChat = () => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
      setIsUserScrolledUp(false);
    }
  };

  // Sync current user presence to Firestore with Firebase Auth UID
  useEffect(() => {
    const client = clientRef.current;
    const currentUser = auth.currentUser;
    if (joined && client && client.uid && currentUser && userProfile.fullname && userProfile.fullname !== "Loading...") {
      setDoc(
        doc(db, "roomParticipants", `${channelName}_${client.uid}`),
        {
          agoraUid: client.uid,
          firebaseUid: currentUser.uid,
          fullname: userProfile.fullname,
          photoURL: userProfile.photoURL,
          role: userProfile.role,
        },
        { merge: true }
      ).catch((err) => console.error("Error updating room presence:", err));
    }
  }, [joined, userProfile, channelName]);

  const fetchRemoteProfile = async (agoraUid) => {
    for (let i = 0; i < 3; i++) {
      try {
        const docRef = doc(db, "roomParticipants", `${channelName}_${agoraUid}`);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const data = snap.data();
          if (data.fullname && data.fullname !== "Loading...") {
            return {
              fullname: data.fullname,
              photoURL: data.photoURL || null,
              role: data.role || "student",
              firebaseUid: data.firebaseUid || null,
            };
          }
        }
      } catch (err) {
        console.error("Error fetching remote profile:", err);
      }
      await new Promise((res) => setTimeout(res, 800));
    }
    return { fullname: `User ${agoraUid}`, photoURL: null, role: "student", firebaseUid: null };
  };

  useEffect(() => {
    let isMounted = true;
    setConnectionStatus("connecting");
    setErrorMessage(null);

    const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
    clientRef.current = client;

    const initAgora = async () => {
      try {
        const tokenResponse = await fetch(`/api/generateAgoraToken?channelName=${encodeURIComponent(channelName)}`);
        if (!tokenResponse.ok) {
          const errData = await tokenResponse.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to fetch secure token from backend.");
        }

        const tokenData = await tokenResponse.json();
        const token = tokenData.token;
        const uid = tokenData.uid || null;

        client.on("user-published", async (user, mediaType) => {
          await client.subscribe(user, mediaType);
          const profile = await fetchRemoteProfile(user.uid);

          if (mediaType === "audio") {
            try {
              if (activePlaybackId && user.audioTrack?.setPlaybackDevice) {
                await user.audioTrack.setPlaybackDevice(activePlaybackId);
              }
              await user.audioTrack?.play();
            } catch (e) {
              console.error("Error playing main channel audio track:", e);
            }
          }

          if (mediaType === "video") {
            setRemoteUsers((prev) => {
              const existing = prev.find((u) => u.uid === user.uid);
              if (existing) {
                return prev.map((u) =>
                  u.uid === user.uid
                    ? {
                        ...u,
                        user,
                        fullname: profile.fullname !== `User ${user.uid}` ? profile.fullname : u.fullname,
                        photoURL: profile.photoURL || u.photoURL,
                        role: profile.role || u.role || "student",
                        firebaseUid: profile.firebaseUid || u.firebaseUid || null,
                        hasVideo: true,
                        videoTrack: user.videoTrack,
                      }
                    : u
                );
              } else {
                return [
                  ...prev,
                  {
                    uid: user.uid,
                    user,
                    hasVideo: true,
                    hasAudio: true,
                    videoTrack: user.videoTrack,
                    audioTrack: user.audioTrack,
                    fullname: profile.fullname,
                    photoURL: profile.photoURL,
                    role: profile.role || "student",
                    firebaseUid: profile.firebaseUid || null,
                  },
                ];
              }
            });
          }
        });

        client.on("user-unpublished", (user, mediaType) => {
          setRemoteUsers((prev) =>
            prev.map((u) => {
              if (u.uid === user.uid) {
                return {
                  ...u,
                  ...(mediaType === "video" ? { hasVideo: false, videoTrack: null } : {}),
                  ...(mediaType === "audio" ? { hasAudio: false, audioTrack: null } : {}),
                };
              }
              return u;
            })
          );
        });

        client.on("user-left", (user) => {
          setRemoteUsers((prev) => prev.filter((u) => u.uid !== user.uid));
        });

        await client.join(APP_ID, channelName, token, uid);

        client.enableAudioVolumeIndicator();
        client.on("volume-indicator", (volumes) => {
          const speakers = {};
          volumes.forEach((volume) => {
            if (volume.level > 3) {
              speakers[String(volume.uid)] = true;
              if (volume.uid === 0 && client.uid) {
                speakers[String(client.uid)] = true;
              }
            }
          });
          setActiveSpeakers(speakers);
        });

        const [audioTrack, videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks(
          {},
          {
            encoderConfig: {
              width: 1280,
              height: 720,
              frameRate: 30,
              bitrateMax: 2000,
            },
            optimizationMode: "motion",
          }
        );
        localTracksRef.current = { audioTrack, videoTrack };

        if (localVideoRef.current && isMounted) {
          videoTrack.play(localVideoRef.current);
        }

        await client.publish([audioTrack, videoTrack]);

        const playbacks = await AgoraRTC.getPlaybackDevices();
        const mics = await AgoraRTC.getMicrophones();
        const cams = await AgoraRTC.getCameras();

        if (isMounted) {
          setPlaybackDevices(playbacks);
          setMicrophones(mics);
          setCameras(cams);
          if (audioTrack.getTrackLabel) setActiveMicId(audioTrack.getTrackLabel());
          if (videoTrack.getTrackLabel) setActiveCamId(videoTrack.getTrackLabel());
          setJoined(true);
          setConnectionStatus("connected");
        }
      } catch (error) {
        console.error("Agora Frontend Connection Error:", error);
        if (isMounted) {
          setConnectionStatus("error");
          setErrorMessage(`Failed to initialize media or join Agora room: ${error.message || error}`);
        }
      }
    };

    initAgora();

    return () => {
      isMounted = false;
      const { audioTrack, videoTrack } = localTracksRef.current;
      if (audioTrack) {
        audioTrack.stop();
        audioTrack.close();
      }
      if (videoTrack) {
        videoTrack.stop();
        videoTrack.close();
      }
      client.leave();
    };
  }, [channelName]);

  useEffect(() => {
    if (!joined) return;

    let isMounted = true;
    const screenClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
    screenClientRef.current = screenClient;

    const initScreenClient = async () => {
      try {
        const screenChannelName = `${channelName}-screen`;
        const tokenResponse = await fetch(`/api/generateAgoraToken?channelName=${encodeURIComponent(screenChannelName)}`);
        if (!tokenResponse.ok) return;
        const tokenData = await tokenResponse.json();

        screenClient.on("user-published", async (user, mediaType) => {
          await screenClient.subscribe(user, mediaType);
          const profile = await fetchRemoteProfile(user.uid);

          if (mediaType === "audio") {
            try {
              if (activePlaybackId && user.audioTrack?.setPlaybackDevice) {
                await user.audioTrack.setPlaybackDevice(activePlaybackId);
              }
              await user.audioTrack?.play();
            } catch (audioErr) {
              console.error("Error playing remote screen audio track:", audioErr);
            }
          }

          if (mediaType === "video") {
            if (!isMounted) return;
            setRemoteScreenShares((prev) => {
              const existing = prev.find((s) => s.uid === user.uid);
              if (existing) {
                return prev.map((s) => (s.uid === user.uid ? { ...s, videoTrack: user.videoTrack, fullname: profile.fullname } : s));
              }
              return [...prev, { uid: user.uid, videoTrack: user.videoTrack, fullname: profile.fullname }];
            });
          }
        });

        screenClient.on("user-unpublished", (user, mediaType) => {
          if (!isMounted) return;
          if (mediaType === "audio") {
            user.audioTrack?.stop();
          }
          if (mediaType === "video") {
            setRemoteScreenShares((prev) => prev.filter((s) => s.uid !== user.uid));
          }
        });

        screenClient.on("user-left", (user) => {
          if (!isMounted) return;
          setRemoteScreenShares((prev) => prev.filter((s) => s.uid !== user.uid));
        });

        const mainUid = clientRef.current?.uid || null;
        await screenClient.join(APP_ID, screenChannelName, tokenData.token, mainUid);
      } catch (err) {
        console.error("Error initializing screen client:", err);
      }
    };

    initScreenClient();

    return () => {
      isMounted = false;
      screenClient.leave();
      screenClientRef.current = null;
    };
  }, [joined, channelName]);

  const toggleRaiseHand = async () => {
    if (!classDocId) return;
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    const nextState = !isHandRaised;
    setIsHandRaised(nextState);

    try {
      const signalId = Date.now() + Math.random();
      const signalText = nextState 
        ? `${userProfile.fullname} raises a hand` 
        : `${userProfile.fullname} lowered their hand`;

      await updateDoc(doc(db, "live_classes", classDocId), {
        [`handRaises.${currentUser.uid}`]: nextState ? { fullname: userProfile.fullname, timestamp: Date.now() } : null,
        lastSignal: {
          id: signalId,
          uid: currentUser.uid,
          fullname: userProfile.fullname,
          text: signalText,
          type: "hand",
          timestamp: Date.now(),
        }
      });
    } catch (err) {
      console.error("Error updating hand raise state:", err);
    }
  };

  const sendHeartReaction = async () => {
    if (!classDocId) return;
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    try {
      const signalId = Date.now() + Math.random();
      await updateDoc(doc(db, "live_classes", classDocId), {
        lastSignal: {
          id: signalId,
          uid: currentUser.uid,
          fullname: userProfile.fullname,
          text: `${userProfile.fullname} reacted a heart`,
          type: "heart",
          timestamp: Date.now(),
        }
      });
    } catch (err) {
      console.error("Error sending heart reaction:", err);
    }
  };

  const profesorLowerHand = async (studentUid) => {
    if (!classDocId || !isCreatorOrProf) return;
    try {
      await updateDoc(doc(db, "live_classes", classDocId), {
        [`handRaises.${studentUid}`]: null,
      });
    } catch (err) {
      console.error("Error lowering hand:", err);
    }
  };

  const handleScreenShareClick = () => {
    if (isMobile) {
      setModalErrorMessage("Screen sharing is locked/restricted on mobile web browsers.");
      setShowErrorModal(true);
      return;
    }
    if (isSharingScreen) {
      stopScreenShare();
    } else {
      if (allScreenShares.length > 0) {
        setModalErrorMessage("Another user is currently sharing their screen. Only one user can share screen at a time.");
        setShowErrorModal(true);
        return;
      }

      if (!isCreatorOrProf && screenSharePermission === "not_permitted") {
        setModalErrorMessage("Screen sharing is not permitted by the professor.");
        setShowErrorModal(true);
        return;
      }
      if (!isCreatorOrProf && screenSharePermission === "ask_first") {
        setShowScreenShareRequestModal(true);
        return;
      }
      startScreenShare();
    }
  };

  const submitScreenShareRequest = async () => {
    setShowScreenShareRequestModal(false);
    setIsWaitingForApproval(true);
    try {
      const currentUser = auth.currentUser;
      if (currentUser && classDocId) {
        await updateDoc(doc(db, "live_classes", classDocId), {
          [`screenShareRequests.${currentUser.uid}`]: {
            uid: currentUser.uid,
            fullname: userProfile.fullname,
            status: "pending",
            timestamp: Date.now(),
          },
        });
      }
    } catch (err) {
      console.error("Error submitting screen share request:", err);
      setIsWaitingForApproval(false);
      setModalErrorMessage("Failed to send screen share request.");
      setShowErrorModal(true);
    }
  };

  const handleApproveRequest = async (studentUid) => {
    if (allScreenShares.length > 0) {
      setModalErrorMessage("A screen share is already active. Only one screen share is allowed at a time.");
      setShowErrorModal(true);
      return;
    }
    if (!classDocId) return;
    try {
      await updateDoc(doc(db, "live_classes", classDocId), {
        [`screenShareRequests.${studentUid}.status`]: "approved",
      });
    } catch (err) {
      console.error("Error approving request:", err);
    }
  };

  const handleRejectRequest = async (studentUid) => {
    if (!classDocId) return;
    try {
      await updateDoc(doc(db, "live_classes", classDocId), {
        [`screenShareRequests.${studentUid}.status`]: "rejected",
      });
    } catch (err) {
      console.error("Error rejecting request:", err);
    }
  };

  const toggleMic = async () => {
    const { audioTrack } = localTracksRef.current;
    if (audioTrack) {
      await audioTrack.setEnabled(!micActive);
      setMicActive(!micActive);
    }
  };

  const toggleCam = async () => {
    const { videoTrack } = localTracksRef.current;
    if (videoTrack) {
      await videoTrack.setEnabled(!camActive);
      setCamActive(!camActive);
    }
  };

  const handlePlaybackChange = async (e) => {
    const newId = e.target.value;
    setActivePlaybackId(newId);
    const { audioTrack } = localTracksRef.current;
    if (audioTrack && audioTrack.setPlaybackDevice) {
      await audioTrack.setPlaybackDevice(newId);
    }
  };

  const handleMicChange = async (e) => {
    const newMicId = e.target.value;
    setActiveMicId(newMicId);
    const { audioTrack } = localTracksRef.current;
    if (audioTrack) {
      await audioTrack.setDevice(newMicId);
    }
  };

  const handleCamChange = async (e) => {
    const newCamId = e.target.value;
    setActiveCamId(newCamId);
    const { videoTrack } = localTracksRef.current;
    if (videoTrack) {
      await videoTrack.setDevice(newCamId);
    }
  };

  const leaveRoom = () => {
    if (isSharingScreen) stopScreenShare();
    navigate("/liveClass");
  };

  const endLiveSession = () => {
    setShowConfirmModal(true);
  };

  const confirmEndLiveSession = async () => {
    setShowConfirmModal(false);
    try {
      if (isSharingScreen) stopScreenShare();
      if (classDocId) {
        await deleteDoc(doc(db, "live_classes", classDocId));
      }
      navigate("/liveClass");
    } catch (err) {
      console.error("Error ending live session:", err);
      setModalErrorMessage("Failed to end the live session.");
      setShowErrorModal(true);
    }
  };

  const isCardSpeaking = (card) => {
    const uidStr = String(card.uid);
    const isLocalSpeaking = card.isLocal && (activeSpeakers["0"] || activeSpeakers[uidStr]);
    const isRemoteSpeaking = !card.isLocal && activeSpeakers[uidStr];
    const isMicOn = card.isLocal ? micActive : (card.hasAudio !== false);
    return (isLocalSpeaking || isRemoteSpeaking) && isMicOn;
  };

  // Reordered Definitions Below

  const localUserCard = {
    uid: clientRef.current?.uid || "local",
    firebaseUid: auth.currentUser?.uid,
    fullname: userProfile.fullname,
    photoURL: userProfile.photoURL,
    isLocal: true,
    isProf: isCreatorOrProf,
    micActive: micActive,
    camActive: camActive,
  };

  const remoteUserCards = remoteUsers.map((u) => {
    const participantData = roomParticipantsMap[`${channelName}_${u.uid}`] || {};
    return {
      uid: u.uid,
      firebaseUid: u.firebaseUid || participantData.firebaseUid || null,
      fullname: u.fullname !== `User ${u.uid}` ? u.fullname : (participantData.fullname || u.fullname),
      photoURL: u.photoURL || participantData.photoURL || null,
      isLocal: false,
      isProf: (participantData.role === "professor" || participantData.role === "admin" || u.role === "professor" || u.role === "admin"),
      hasVideo: u.hasVideo,
      hasAudio: u.hasAudio,
      videoTrack: u.videoTrack,
    };
  });

  const allUserCards = [localUserCard, ...remoteUserCards];
  const profUserCards = allUserCards.filter((u) => u.isProf);
  const studentUserCards = allUserCards.filter((u) => !u.isProf);

  // Fixed Send Chat Message Handler supporting Private DMs
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    let recipientUid = null;
    let recipientName = null;

    if (selectedRecipientUid !== "everyone") {
      recipientUid = selectedRecipientUid;
      const targetUser = allUserCards.find(
        (u) => u.firebaseUid === selectedRecipientUid || String(u.uid) === String(selectedRecipientUid)
      );
      recipientName = targetUser ? targetUser.fullname : "User";
    }

    try {
      await addDoc(collection(db, "roomMessages"), {
        channelName,
        senderUid: currentUser.uid,
        senderName: userProfile.fullname,
        recipientUid,
        recipientName,
        text: newMessage.trim(),
        timestamp: serverTimestamp(),
      });
      setNewMessage("");
    } catch (err) {
      console.error("Error sending chat message:", err);
    }
  };

  // Filter messages visible to current user (Public messages OR DMs where user is sender or target)
  const currentUid = auth.currentUser?.uid;
  const currentAgoraUid = clientRef.current?.uid;
  const visibleMessages = messages.filter((msg) => {
    if (!msg.recipientUid) return true; // Public message visible to everyone
    if (msg.senderUid === currentUid) return true; // Sender can see their sent DM
    if (msg.recipientUid === currentUid) return true; // Targeted recipient sees the DM
    if (currentAgoraUid && String(msg.recipientUid) === String(currentAgoraUid)) return true; // Fallback check for Agora UIDs
    return false;
  });

  const activeScreenShare = allScreenShares.length > 0 ? allScreenShares[0] : null;
  const orderedCards = [];

  if (!activeScreenShare) {
    orderedCards.push(...profUserCards.map((u) => ({ type: "user", ...u })));
    orderedCards.push(...studentUserCards.map((u) => ({ type: "user", ...u })));
  } else if (activeScreenShare.isProf) {
    orderedCards.push({ type: "screenshare", ...activeScreenShare });
    orderedCards.push(...profUserCards.map((u) => ({ type: "user", ...u })));
    orderedCards.push(...studentUserCards.map((u) => ({ type: "user", ...u })));
  } else {
    const sharerUid = activeScreenShare.uid;
    const sharerUserCard = studentUserCards.find((u) => String(u.uid) === String(sharerUid));
    const remainingStudentCards = studentUserCards.filter((u) => String(u.uid) !== String(sharerUid));

    orderedCards.push({ type: "screenshare", ...activeScreenShare });
    if (sharerUserCard) {
      orderedCards.push({ type: "user", ...sharerUserCard });
    }
    orderedCards.push(...profUserCards.map((u) => ({ type: "user", ...u })));
    orderedCards.push(...remainingStudentCards.map((u) => ({ type: "user", ...u })));
  }

  const activeHandRaisesList = Object.entries(handRaises || {}).filter(([_, val]) => val !== null && val !== undefined);

  return (
    <div
      className="container-fluid text-white min-vh-100 d-flex flex-column p-2 p-md-4 position-relative"
      style={{ backgroundColor: "#0b0f19", overflowX: "hidden" }}
      onClick={() => {
        if (isMobile) {
          setActiveScreenControlsId(null);
        }
        setShowChatMenu(false);
      }}
    >
      <style>{`
        #maximized-screen-container video {
          object-fit: contain !important;
          width: 100% !important;
          height: 100% !important;
        }
        @keyframes speakingGlow {
          0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.5); }
          70% { box-shadow: 0 0 0 10px rgba(34, 197, 94, 0); }
          100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
        }
        .speaking-glow {
          animation: speakingGlow 1.5s infinite;
          border: 2px solid #22c55e !important;
        }
        @keyframes floatUpFade {
          0% { transform: translateY(30px) scale(0.8); opacity: 0; }
          20% { transform: translateY(0px) scale(1); opacity: 1; }
          80% { transform: translateY(-50px) scale(1); opacity: 1; }
          100% { transform: translateY(-100px) scale(0.9); opacity: 0; }
        }
        .flying-notification {
          animation: floatUpFade 3.5s ease-in-out forwards;
          pointer-events: none;
        }
      `}</style>

      {/* Flying Notifications Overlay Container */}
      <div
        className="position-fixed start-50 translate-middle-x d-flex flex-column align-items-center gap-2"
        style={{ zIndex: 9999, bottom: "90px", pointerEvents: "none" }}
      >
        {floatingNotifications.map((notif) => (
          <div
            key={notif.uniqueKey}
            className={`flying-notification px-3 py-2 rounded-pill shadow-lg d-flex align-items-center gap-2 fw-semibold text-white ${
              notif.type === "heart" ? "bg-danger bg-opacity-90 border border-danger" : "bg-primary bg-opacity-90 border border-primary"
            }`}
            style={{ fontSize: "14px", backdropFilter: "blur(6px)" }}
          >
            <ion-icon name={notif.type === "heart" ? "heart" : "hand-left"} style={{ fontSize: "18px" }}></ion-icon>
            <span>{notif.text}</span>
          </div>
        ))}
      </div>

      {/* Header Banner */}
      <div
        className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center mb-3 mb-md-4 p-3 rounded-4 shadow-sm gap-3"
        style={{ backgroundColor: "#131b2e", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div>
          <div className="d-flex align-items-center gap-2">
            <span className="p-2 rounded-3 bg-primary bg-opacity-10 text-primary d-flex align-items-center justify-content-center">
              <ion-icon name="videocam-outline" style={{ fontSize: "20px" }}></ion-icon>
            </span>
            <h5 className="fw-bold mb-0 text-white text-truncate" style={{ maxWidth: "280px" }}>
              Room: <span className="text-primary">{channelName}</span>
            </h5>
          </div>
          <div className="d-flex flex-wrap align-items-center gap-2 mt-2">
            <small className="text-secondary d-flex align-items-center gap-1">
              <ion-icon name="shield-checkmark-outline"></ion-icon> Secure Stream
            </small>

            {connectionStatus === "connecting" && (
              <span className="badge bg-warning text-dark fw-semibold px-2 py-1 d-flex align-items-center gap-1" style={{ fontSize: "11px" }}>
                <ion-icon name="hourglass-outline"></ion-icon> Connecting...
              </span>
            )}
            {connectionStatus === "connected" && (
              <span className="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25 fw-semibold px-2 py-1 d-flex align-items-center gap-1" style={{ fontSize: "11px" }}>
                <ion-icon name="radio-button-on-outline"></ion-icon> Connected
              </span>
            )}
            {connectionStatus === "error" && (
              <span className="badge bg-danger bg-opacity-10 text-danger border border-danger border-opacity-25 fw-semibold px-2 py-1 d-flex align-items-center gap-1" style={{ fontSize: "11px" }}>
                <ion-icon name="alert-circle-outline"></ion-icon> Error
              </span>
            )}
          </div>
        </div>

        <div className="d-flex align-items-center gap-2 w-100 w-md-auto justify-content-end flex-wrap">
          {isCreatorOrProf && (
            <div className="d-flex align-items-center gap-1 bg-dark bg-opacity-50 px-2 py-1 rounded-3 border border-secondary border-opacity-25">
              <small className="text-secondary" style={{ fontSize: "11px" }}>
                Share Access:
              </small>
              <select
                className="form-select form-select-sm bg-dark text-white border-secondary shadow-none py-1"
                style={{ fontSize: "12px", width: "135px" }}
                value={screenSharePermission}
                onChange={async (e) => {
                  const newPerm = e.target.value;
                  setScreenSharePermission(newPerm);
                  if (classDocId) {
                    await updateDoc(doc(db, "live_classes", classDocId), { screenSharePermission: newPerm });
                  }
                }}
              >
                <option value="ask_first">Ask First</option>
                <option value="can_share">Can Share</option>
                <option value="not_permitted">Not Permitted</option>
              </select>
            </div>
          )}

          <button
            className="btn btn-outline-light rounded-pill px-3 py-2 fw-semibold d-flex align-items-center gap-1 flex-grow-1 flex-md-grow-0 justify-content-center"
            onClick={() => setShowSettingsModal(!showSettingsModal)}
            style={{ fontSize: "13px", borderColor: "rgba(255,255,255,0.2)" }}
          >
            <ion-icon name="options-outline" style={{ fontSize: "16px" }}></ion-icon> Settings
          </button>

          {isCreatorOrProf && (
            <button
              className="btn btn-danger rounded-pill px-3 py-2 fw-semibold shadow-sm d-flex align-items-center gap-1 flex-grow-1 flex-md-grow-0 justify-content-center"
              onClick={endLiveSession}
              style={{ fontSize: "13px" }}
              title="End session for everyone and delete class card"
            >
              <ion-icon name="power-outline" style={{ fontSize: "16px" }}></ion-icon> End Live
            </button>
          )}

          <button
            className="btn btn-outline-secondary text-white rounded-pill px-3 py-2 fw-semibold shadow-sm d-flex align-items-center gap-1 flex-grow-1 flex-md-grow-0 justify-content-center"
            onClick={leaveRoom}
            style={{ fontSize: "13px", borderColor: "rgba(255,255,255,0.15)" }}
          >
            <ion-icon name="log-out-outline" style={{ fontSize: "16px" }}></ion-icon> Leave
          </button>
        </div>
      </div>

      {/* Professor Raised Hands Panel */}
      {isCreatorOrProf && activeHandRaisesList.length > 0 && (
        <div className="alert alert-warning border-0 shadow-lg rounded-4 mb-4 mx-2 d-flex flex-column gap-2" style={{ backgroundColor: "rgba(255, 193, 7, 0.15)", color: "#ffffff", border: "1px solid rgba(255, 193, 7, 0.3)" }}>
          <div className="d-flex align-items-center justify-content-between">
            <h6 className="fw-bold d-flex align-items-center gap-2 mb-0 text-warning">
              <ion-icon name="hand-left-outline" style={{ fontSize: "20px" }}></ion-icon> Raised Hands
            </h6>
            <span className="badge bg-warning text-dark">
              {activeHandRaisesList.length} Raised
            </span>
          </div>
          <div className="d-flex flex-wrap gap-2 mt-1">
            {activeHandRaisesList.map(([uid, data]) => (
              <div key={uid} className="d-flex align-items-center justify-content-between bg-dark bg-opacity-50 px-3 py-1 rounded-pill border border-warning border-opacity-25 gap-3">
                <span className="fw-semibold text-white small">
                  <strong className="text-warning">{data.fullname || "Student"}</strong> raised a hand
                </span>
                <button
                  className="btn btn-sm btn-outline-warning py-0 px-2 rounded-pill"
                  style={{ fontSize: "11px" }}
                  onClick={() => profesorLowerHand(uid)}
                >
                  Lower
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Professor Screen Share Requests Banner */}
      {isCreatorOrProf && Object.values(screenShareRequests).filter((r) => r && r.status === "pending").length > 0 && (
        <div className="alert alert-primary border-0 shadow-lg rounded-4 mb-4 mx-2 d-flex flex-column gap-2" style={{ backgroundColor: "rgba(13, 110, 253, 0.15)", color: "#ffffff", border: "1px solid rgba(13, 110, 253, 0.3)" }}>
          <div className="d-flex align-items-center justify-content-between">
            <h6 className="fw-bold d-flex align-items-center gap-2 mb-0 text-primary">
              <ion-icon name="desktop-outline" style={{ fontSize: "20px" }}></ion-icon> Incoming Screen Share Requests
            </h6>
            <span className="badge bg-primary">
              {Object.values(screenShareRequests).filter((r) => r && r.status === "pending").length} Pending
            </span>
          </div>
          <div className="d-flex flex-column gap-2 mt-1">
            {Object.values(screenShareRequests)
              .filter((req) => req && req.status === "pending")
              .map((req) => (
                <div key={req.uid} className="d-flex align-items-center justify-content-between bg-dark bg-opacity-50 p-2 rounded-3 border border-secondary border-opacity-25">
                  <span className="fw-semibold text-white small">
                    <strong className="text-primary">{req.fullname}</strong> wants to share their screen.
                  </span>
                  <div className="d-flex gap-2">
                    <button
                      className="btn btn-sm btn-success px-3 py-1 rounded-pill fw-semibold shadow-sm d-flex align-items-center gap-1"
                      style={{ fontSize: "12px" }}
                      onClick={() => handleApproveRequest(req.uid)}
                    >
                      <ion-icon name="checkmark-outline"></ion-icon> Yes
                    </button>
                    <button
                      className="btn btn-sm btn-danger px-3 py-1 rounded-pill fw-semibold shadow-sm d-flex align-items-center gap-1"
                      style={{ fontSize: "12px" }}
                      onClick={() => handleRejectRequest(req.uid)}
                    >
                      <ion-icon name="close-outline"></ion-icon> No
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Device Settings Modal */}
      {showSettingsModal && (
        <div className="card border-0 shadow-lg rounded-4 p-3 p-md-4 mb-4 text-white mx-0 mx-md-2" style={{ backgroundColor: "#131b2e", border: "1px solid rgba(13, 110, 253, 0.3)" }}>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h6 className="fw-bold mb-0 text-primary d-flex align-items-center gap-2">
              <ion-icon name="settings-outline"></ion-icon> Audio & Video Configurations
            </h6>
            <button className="btn btn-sm btn-dark text-white rounded-circle" onClick={() => setShowSettingsModal(false)}>
              <ion-icon name="close-outline" style={{ fontSize: "18px" }}></ion-icon>
            </button>
          </div>
          <div className="row g-3">
            <div className="col-12 col-md-4">
              <label className="form-label text-secondary small fw-semibold">Headset / Speaker</label>
              <div className="input-group">
                <span className="input-group-text bg-dark border-secondary text-primary">
                  <ion-icon name="headset-outline"></ion-icon>
                </span>
                <select className="form-select bg-dark text-white border-secondary shadow-none" value={activePlaybackId} onChange={handlePlaybackChange}>
                  <option value="">Default Speaker</option>
                  {playbackDevices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Speaker (${device.deviceId.slice(0, 5)}...)`}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="col-12 col-md-4">
              <label className="form-label text-secondary small fw-semibold">Microphone</label>
              <div className="input-group">
                <span className="input-group-text bg-dark border-secondary text-primary">
                  <ion-icon name="mic-outline"></ion-icon>
                </span>
                <select className="form-select bg-dark text-white border-secondary shadow-none" value={activeMicId} onChange={handleMicChange}>
                  {microphones.map((mic) => (
                    <option key={mic.deviceId} value={mic.deviceId}>
                      {mic.label || `Microphone (${mic.deviceId.slice(0, 5)}...)`}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="col-12 col-md-4">
              <label className="form-label text-secondary small fw-semibold">Camera</label>
              <div className="input-group">
                <span className="input-group-text bg-dark border-secondary text-primary">
                  <ion-icon name="videocam-outline"></ion-icon>
                </span>
                <select className="form-select bg-dark text-white border-secondary shadow-none" value={activeCamId} onChange={handleCamChange}>
                  {cameras.map((cam) => (
                    <option key={cam.deviceId} value={cam.deviceId}>
                      {cam.label || `Camera (${cam.deviceId.slice(0, 5)}...)`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="alert alert-danger border-0 shadow-lg rounded-4 mb-4 mx-2" role="alert" style={{ backgroundColor: "rgba(220, 53, 69, 0.15)", color: "#ff8b94" }}>
          <h5 className="alert-heading fw-bold d-flex align-items-center gap-2">
            <ion-icon name="warning-outline"></ion-icon> Connection Error
          </h5>
          <p className="mb-1">{errorMessage}</p>
        </div>
      )}

      {/* Maximized Fullscreen Overlay */}
      {maximizedScreenId && (() => {
        const shouldRotateLandscape = isMobile && maximizedOrientation === "landscape" && isPhysicalPortrait;

        return (
          <div
            id="maximized-screen-container"
            className="bg-black d-flex flex-column justify-content-center align-items-center overflow-hidden position-fixed"
            style={{
              zIndex: 99999,
              top: shouldRotateLandscape ? "50%" : 0,
              left: shouldRotateLandscape ? "50%" : 0,
              right: shouldRotateLandscape ? "auto" : 0,
              bottom: shouldRotateLandscape ? "auto" : 0,
              width: shouldRotateLandscape ? "100dvh" : "100dvw",
              height: shouldRotateLandscape ? "100dvw" : "100dvh",
              transform: shouldRotateLandscape ? "translate(-50%, -50%) rotate(90deg)" : "none",
              transformOrigin: "center center",
              transition: "transform 0.25s ease, width 0.25s ease, height 0.25s ease",
              cursor: showMaximizedControls ? "default" : "none",
            }}
            onMouseMove={resetControlsTimeout}
            onTouchStart={resetControlsTimeout}
            onClick={(e) => {
              e.stopPropagation();
              resetControlsTimeout();
            }}
            ref={maximizedContainerRef}
          >
            <div
              className="position-absolute d-flex align-items-center gap-2"
              style={{
                zIndex: 20000,
                top: "max(14px, env(safe-area-inset-top))",
                right: "max(14px, env(safe-area-inset-right))",
                opacity: showMaximizedControls ? 1 : 0,
                pointerEvents: showMaximizedControls ? "auto" : "none",
                transition: "opacity 0.3s ease",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {isMobile && (
                <button
                  className="btn btn-dark bg-opacity-75 text-white btn-sm rounded-pill px-3 py-2 fw-semibold d-flex align-items-center gap-1 shadow border border-secondary border-opacity-50"
                  onClick={toggleMaximizedOrientation}
                  style={{ fontSize: "12px", backdropFilter: "blur(4px)" }}
                >
                  <ion-icon name={maximizedOrientation === "landscape" ? "phone-portrait-outline" : "phone-landscape-outline"}></ion-icon>
                  {maximizedOrientation === "landscape" ? "Portrait" : "Landscape"}
                </button>
              )}
              <button
                className="btn btn-danger btn-sm rounded-pill px-3 py-2 fw-semibold shadow d-flex align-items-center gap-1"
                onClick={closeMaximizedView}
                style={{ fontSize: "12px" }}
              >
                <ion-icon name="contract-outline" style={{ fontSize: "16px" }}></ion-icon> Minimize
              </button>
            </div>

            <div className="w-100 h-100 d-flex align-items-center justify-content-center p-0 m-0 overflow-hidden bg-black">
              <div
                ref={maximizedVideoRef}
                className="bg-black w-100 h-100 d-flex align-items-center justify-content-center"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                }}
              />
            </div>
          </div>
        );
      })()}

      {/* Main Grid + Zoom-Like Chatroom Sidebar */}
      <div className="row g-3 flex-grow-1 align-items-start justify-content-center p-1">
        <div className={showChat ? "col-12 col-lg-8 d-flex flex-column" : "col-12 col-lg-12 d-flex flex-column"}>
          
          {/* ---> EDITED ROW: Added justify-content-center to balance and center all cards <--- */}
          <div className="row justify-content-center g-3 w-100 m-0">
            {orderedCards.map((card) => {
              if (card.type === "screenshare") {
                const showControlsOnMobile = activeScreenControlsId === card.id;
                const isHovered = hoveredScreenId === card.id;

                return (
                  <div key={card.id} className="col-12 col-lg-12">
                    <div
                      className="card border-0 shadow-lg rounded-4 overflow-hidden position-relative w-100"
                      style={{
                        height: "360px",
                        backgroundColor: "#101726",
                        border: "1px solid rgba(13, 110, 253, 0.4)",
                      }}
                      onMouseEnter={() => setHoveredScreenId(card.id)}
                      onMouseLeave={() => setHoveredScreenId(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isMobile) {
                          setActiveScreenControlsId(activeScreenControlsId === card.id ? null : card.id);
                        }
                      }}
                    >
                      <div
                        className="w-100 h-100 bg-black position-absolute top-0 start-0"
                        ref={(node) => {
                          if (node && card.videoTrack && maximizedScreenId !== card.id) {
                            card.videoTrack.play(node);
                          }
                        }}
                        style={{ objectFit: "contain" }}
                      />

                      <div className="position-absolute top-0 start-0 m-3 p-2 bg-dark bg-opacity-75 rounded-3 d-flex align-items-center gap-2 shadow-sm" style={{ zIndex: 10 }}>
                        <span className="badge bg-primary text-white me-1">Screen Share</span>
                        <span className="text-white small fw-bold">
                          {card.isLocal ? `${card.fullname} (You)` : card.fullname}
                        </span>
                      </div>

                      <div
                        className={`position-absolute top-0 end-0 m-3 ${isMobile ? (showControlsOnMobile ? "d-block" : "d-none") : (isHovered ? "d-block" : "d-none")}`}
                        style={{ zIndex: 15 }}
                      >
                        <button
                          className="btn btn-dark bg-opacity-75 text-white btn-sm rounded-pill px-3 py-2 fw-semibold shadow d-flex align-items-center gap-1 border border-secondary border-opacity-50"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMaximizedScreenId(card.id);
                          }}
                        >
                          <ion-icon name="expand-outline" style={{ fontSize: "16px" }}></ion-icon> Maximize
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              const speaking = isCardSpeaking(card);
              const userHandRaised = card.isLocal ? isHandRaised : !!handRaises[card.uid];

              // ---> EDITED COLUMN: Changed col-lg-4 to col-lg-3 for a maximum of 4 per row <---
              return (
                <div key={card.isLocal ? "local-user" : `remote-user-${card.uid}`} className="col-12 col-md-6 col-lg-3">
                  <div
                    className={`card border-0 shadow-lg rounded-4 overflow-hidden position-relative ${speaking ? "speaking-glow" : ""}`}
                    style={{
                      height: activeScreenShare ? "360px" : "320px",
                      backgroundColor: "#131b2e",
                      border: speaking
                        ? "2px solid #22c55e"
                        : (card.isProf ? "2px solid rgba(13, 110, 253, 0.6)" : "1px solid rgba(255,255,255,0.06)"),
                      transition: "border 0.2s ease, box-shadow 0.2s ease",
                    }}
                  >
                    {card.isProf && (
                      <div className="position-absolute top-0 start-0 m-2 px-2 py-1 bg-primary rounded-2 text-white fw-semibold shadow-sm" style={{ zIndex: 10, fontSize: "11px" }}>
                        <ion-icon name="school-outline" className="me-1"></ion-icon> Professor Lead
                      </div>
                    )}

                    {userHandRaised && (
                      <div className="position-absolute top-0 start-0 m-2 px-2 py-1 bg-warning text-dark rounded-2 fw-bold shadow-sm d-flex align-items-center gap-1" style={{ zIndex: 11, fontSize: "11px", marginTop: card.isProf ? "34px" : "8px" }}>
                        <ion-icon name="hand-left"></ion-icon> Hand Raised
                      </div>
                    )}

                    {speaking && (
                      <div className="position-absolute top-0 end-0 m-2 px-2 py-1 bg-success text-white rounded-pill fw-semibold shadow-sm d-flex align-items-center gap-1" style={{ zIndex: 10, fontSize: "11px" }}>
                        <ion-icon name="volume-high-outline"></ion-icon> Speaking...
                      </div>
                    )}

                    {card.isLocal ? (
                      <>
                        <div
                          ref={localVideoCallbackRef}
                          className={`w-100 h-100 bg-black ${!camActive ? "d-none" : ""}`}
                          style={{ objectFit: "cover" }}
                        />

                        {!camActive && (
                          <div className="w-100 h-100 d-flex flex-column align-items-center justify-content-center position-absolute top-0 start-0" style={{ backgroundColor: "#101726" }}>
                            {card.photoURL ? (
                              <img
                                src={card.photoURL}
                                alt={card.fullname}
                                className="rounded-circle object-fit-cover shadow-sm mb-2 border border-2 border-primary"
                                style={{ width: "84px", height: "84px" }}
                              />
                            ) : (
                              <div className="bg-primary bg-gradient rounded-circle text-white d-flex align-items-center justify-content-center fw-bold fs-2 shadow-sm mb-2 border border-2 border-primary" style={{ width: "84px", height: "84px" }}>
                                {card.fullname ? card.fullname.charAt(0).toUpperCase() : "U"}
                              </div>
                            )}
                            <span className="text-white fw-bold">{card.fullname}</span>
                            <span className="text-secondary small mt-1 d-flex align-items-center gap-1">
                              <ion-icon name="videocam-off-outline"></ion-icon> Camera is off
                            </span>
                          </div>
                        )}

                        <div className="position-absolute bottom-0 start-0 p-3 bg-dark bg-opacity-75 w-100 d-flex justify-content-between align-items-center" style={{ zIndex: 5 }}>
                          <span className="text-white fw-bold small d-flex align-items-center gap-1 text-truncate" style={{ maxWidth: "60%" }}>
                            <ion-icon name="person-circle-outline" style={{ fontSize: "16px" }}></ion-icon> {card.fullname} (You)
                          </span>
                          <span className={`badge ${micActive ? "bg-success text-white" : "bg-danger text-white"} d-flex align-items-center gap-1 px-2 py-1`} style={{ fontSize: "11px" }}>
                            <ion-icon name={micActive ? "mic-outline" : "mic-off-outline"}></ion-icon> {micActive ? "Mic On" : "Muted"}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div
                          id={`remote-video-${card.uid}`}
                          ref={(node) => {
                            if (node && card.hasVideo && card.videoTrack) {
                              card.videoTrack.play(node);
                            }
                          }}
                          className={`w-100 h-100 bg-black ${!card.hasVideo ? "d-none" : ""}`}
                          style={{ objectFit: "cover" }}
                        />

                        {!card.hasVideo && (
                          <div className="w-100 h-100 d-flex flex-column align-items-center justify-content-center position-absolute top-0 start-0" style={{ backgroundColor: "#101726" }}>
                            {card.photoURL ? (
                              <img
                                src={card.photoURL}
                                alt={card.fullname}
                                className="rounded-circle object-fit-cover shadow-sm mb-2 border border-2 border-primary"
                                style={{ width: "84px", height: "84px" }}
                              />
                            ) : (
                              <div className="bg-primary bg-gradient rounded-circle text-white d-flex align-items-center justify-content-center fw-bold fs-2 shadow-sm mb-2 border border-2 border-primary" style={{ width: "84px", height: "84px" }}>
                                {card.fullname ? card.fullname.charAt(0).toUpperCase() : "U"}
                              </div>
                            )}
                            <span className="text-white fw-bold">{card.fullname}</span>
                            <span className="text-secondary small mt-1 d-flex align-items-center gap-1">
                              <ion-icon name="videocam-off-outline"></ion-icon> Camera is off
                            </span>
                          </div>
                        )}

                        <div className="position-absolute bottom-0 start-0 p-3 bg-dark bg-opacity-75 w-100 d-flex justify-content-between align-items-center" style={{ zIndex: 5 }}>
                          <span className="text-white fw-bold small d-flex align-items-center gap-1 text-truncate" style={{ maxWidth: "60%" }}>
                            <ion-icon name="people-outline" style={{ fontSize: "16px" }}></ion-icon> {card.fullname}
                          </span>
                          <span className={`badge ${card.hasAudio !== false ? "bg-success text-white" : "bg-danger text-white"} d-flex align-items-center gap-1 px-2 py-1`} style={{ fontSize: "11px" }}>
                            <ion-icon name={card.hasAudio !== false ? "mic-outline" : "mic-off-outline"}></ion-icon> {card.hasAudio !== false ? "Audio On" : "Muted"}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            {remoteUsers.length === 0 && joined && connectionStatus === "connected" && (
              <div className="text-center text-secondary col-12 py-5">
                <div className="mb-2 text-primary">
                  <ion-icon name="pulse-outline" style={{ fontSize: "36px" }}></ion-icon>
                </div>
                <p className="fs-6 fw-medium text-white">Waiting for other participants to join the room...</p>
              </div>
            )}
          </div>
        </div>

        {/* Zoom-Like Chatroom Sidebar Panel with Working Private Chat Dropdown */}
        {showChat && (
          <div className="col-12 col-lg-4 d-flex flex-column">
            <div
              className="card border-0 shadow-lg rounded-4 d-flex flex-column overflow-hidden position-relative"
              style={{
                backgroundColor: "#131b2e",
                border: "1px solid rgba(13, 110, 253, 0.3)",
                height: "650px",
              }}
            >
              <div className="p-3 bg-dark bg-opacity-50 border-bottom border-secondary border-opacity-25 d-flex align-items-center justify-content-between position-relative">
                <div>
                  <h6 className="fw-bold mb-0 text-primary d-flex align-items-center gap-2">
                    <ion-icon name="chatbubbles-outline" style={{ fontSize: "18px" }}></ion-icon> Meeting Chat
                  </h6>
                  <small className="text-secondary" style={{ fontSize: "11px" }}>
                    {selectedRecipientUid === "everyone" 
                      ? "Chatting with: Everyone (Public)" 
                      : `Private Chat with ${allUserCards.find((u) => u.firebaseUid === selectedRecipientUid || String(u.uid) === String(selectedRecipientUid))?.fullname || "User"}`}
                  </small>
                </div>

                <div className="d-flex align-items-center gap-2">
                  <div className="position-relative" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="btn btn-sm btn-dark text-white rounded-circle d-flex align-items-center justify-content-center border border-secondary border-opacity-50 shadow-sm"
                      style={{ width: "32px", height: "32px" }}
                      onClick={() => setShowChatMenu(!showChatMenu)}
                      title="Choose recipient"
                    >
                      <ion-icon name="ellipsis-vertical" style={{ fontSize: "16px" }}></ion-icon>
                    </button>

                    {showChatMenu && (
                      <div
                        className="position-absolute end-0 mt-2 bg-dark border border-secondary rounded-3 shadow-lg py-2"
                        style={{ zIndex: 1050, width: "230px", backdropFilter: "blur(10px)" }}
                      >
                        <div className="px-3 py-1 text-secondary fw-bold" style={{ fontSize: "10px", letterSpacing: "0.5px" }}>
                          SELECT CHATROOM / USER
                        </div>
                        <button
                          className={`dropdown-item text-white px-3 py-2 small d-flex align-items-center gap-2 ${selectedRecipientUid === "everyone" ? "bg-primary bg-opacity-25 text-primary fw-bold" : ""}`}
                          onClick={() => {
                            setSelectedRecipientUid("everyone");
                            setShowChatMenu(false);
                          }}
                          style={{ fontSize: "12px", background: "transparent" }}
                        >
                          <ion-icon name="people-outline" style={{ fontSize: "16px" }}></ion-icon> Everyone (All Users Chat)
                        </button>
                        <div className="dropdown-divider border-secondary opacity-25 my-1"></div>
                        <div className="px-3 py-1 text-secondary fw-bold" style={{ fontSize: "10px", letterSpacing: "0.5px" }}>
                          PRIVATE 2-WAY CHAT
                        </div>
                        <div style={{ maxHeight: "180px", overflowY: "auto" }}>
                          {allUserCards
                            .filter((u) => {
                              const myFirebaseUid = auth.currentUser?.uid;
                              if (u.isLocal) return false;
                              if (myFirebaseUid && u.firebaseUid === myFirebaseUid) return false;
                              if (clientRef.current?.uid && String(u.uid) === String(clientRef.current.uid)) return false;
                              return true;
                            })
                            .map((u) => {
                              const targetId = u.firebaseUid || u.uid;
                              const isSelected = selectedRecipientUid === targetId;

                              return (
                                <button
                                  key={targetId}
                                  className={`dropdown-item text-white px-3 py-2 small d-flex align-items-center gap-2 text-truncate ${isSelected ? "bg-warning bg-opacity-25 text-warning fw-bold" : ""}`}
                                  onClick={() => {
                                    setSelectedRecipientUid(targetId);
                                    setShowChatMenu(false);
                                  }}
                                  style={{ fontSize: "12px", background: "transparent" }}
                                >
                                  <ion-icon name="person-outline" style={{ fontSize: "14px" }}></ion-icon> {u.fullname} {u.isProf ? "(Prof)" : ""}
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    className="btn btn-sm btn-dark text-white rounded-circle d-flex align-items-center justify-content-center shadow-sm"
                    style={{ width: "32px", height: "32px" }}
                    onClick={() => setShowChat(false)}
                    title="Close Chat"
                  >
                    <ion-icon name="close-outline" style={{ fontSize: "18px" }}></ion-icon>
                  </button>
                </div>
              </div>

              {/* Chat Messages Scrollable Area */}
              <div
                className="flex-grow-1 p-3 overflow-y-auto d-flex flex-column gap-3 position-relative"
                ref={chatScrollRef}
                onScroll={handleChatScroll}
                style={{ backgroundColor: "#0e1525" }}
              >
                {visibleMessages.length === 0 ? (
                  <div className="text-center text-secondary my-auto small">
                    <ion-icon name="chatbubble-ellipses-outline" style={{ fontSize: "36px" }} className="mb-1 text-muted"></ion-icon>
                    <p className="mb-0">
                      {selectedRecipientUid === "everyone" 
                        ? "No messages in public chat yet." 
                        : "No private messages yet. Start your 1-on-1 chat below!"}
                    </p>
                  </div>
                ) : (
                  visibleMessages.map((msg) => {
                    const isMe = msg.senderUid === auth.currentUser?.uid;
                    const isDM = !!msg.recipientUid;
                    const timeString = msg.timestamp?.toDate
                      ? msg.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : "Just now";

                    return (
                      <div
                        key={msg.id}
                        className={`d-flex flex-column ${isMe ? "align-items-end" : "align-items-start"}`}
                      >
                        <div className="d-flex align-items-center gap-2 mb-1">
                          <span className="text-secondary fw-semibold" style={{ fontSize: "12px" }}>
                            {isMe ? "You" : msg.senderName}
                          </span>
                          <span className="text-muted" style={{ fontSize: "10px" }}>
                            {timeString}
                          </span>
                          {isDM && (
                            <span className="badge bg-warning text-dark px-2 py-0 fw-bold" style={{ fontSize: "10px" }}>
                              {isMe ? `(Private to ${msg.recipientName})` : "(Private Chat)"}
                            </span>
                          )}
                        </div>
                        <div
                          className={`p-2 px-3 rounded-4 shadow-sm text-white ${
                            isDM
                              ? "bg-warning bg-opacity-15 border border-warning border-opacity-50 text-dark"
                              : isMe
                              ? "bg-primary text-white"
                              : "bg-dark border border-secondary border-opacity-25"
                          }`}
                          style={{
                            maxWidth: "88%",
                            fontSize: "13px",
                            wordBreak: "break-word",
                            backgroundColor: isDM ? "rgba(255, 193, 7, 0.2)" : undefined,
                          }}
                        >
                          {msg.text}
                        </div>
                      </div>
                    );
                  })
                )}

                {isUserScrolledUp && (
                  <button
                    className="position-sticky bottom-0 start-50 translate-middle-x btn btn-sm btn-primary shadow-lg rounded-pill px-3 py-1 d-flex align-items-center gap-1 mb-2 border border-light border-opacity-25"
                    style={{ fontSize: "12px", zIndex: 10, width: "fit-content" }}
                    onClick={scrollToBottomChat}
                  >
                    <ion-icon name="arrow-down-outline"></ion-icon> New messages below
                  </button>
                )}
              </div>

              {/* Zoom Chat Input Form */}
              <form onSubmit={handleSendMessage} className="p-3 bg-dark bg-opacity-50 border-top border-secondary border-opacity-25 d-flex flex-column gap-2">
                <div className="d-flex align-items-center justify-content-between px-1">
                  <span className="text-secondary small d-flex align-items-center gap-1" style={{ fontSize: "11px" }}>
                    <ion-icon name={selectedRecipientUid === "everyone" ? "people-outline" : "person-outline"}></ion-icon>
                    To: <strong className={selectedRecipientUid === "everyone" ? "text-primary" : "text-warning"}>
                      {selectedRecipientUid === "everyone" ? "Everyone (Public Chat)" : (allUserCards.find((u) => u.firebaseUid === selectedRecipientUid || String(u.uid) === String(selectedRecipientUid))?.fullname || "User")}
                    </strong>
                  </span>
                  <small className="text-muted" style={{ fontSize: "10px" }}>Click 3 dots to switch</small>
                </div>

                <div className="input-group">
                  <input
                    type="text"
                    className="form-control form-control-sm bg-dark text-white border-secondary shadow-none py-2"
                    placeholder={
                      selectedRecipientUid === "everyone"
                        ? "Type message to everyone..."
                        : `Type private message...`
                    }
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    style={{ fontSize: "13px" }}
                  />
                  <button
                    className="btn btn-primary btn-sm px-3 d-flex align-items-center justify-content-center shadow-sm"
                    type="submit"
                    title="Send Message"
                  >
                    <ion-icon name="send" style={{ fontSize: "14px" }}></ion-icon>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* Floating Control Bar */}
      <div className="d-flex justify-content-center gap-2 gap-md-3 py-2 px-3 px-md-4 mt-auto shadow-lg mx-auto rounded-pill mb-2 align-items-center flex-wrap" style={{ backgroundColor: "#131b2e", border: "1px solid rgba(255,255,255,0.08)", zIndex: 100 }}>
        <button
          className={`btn ${micActive ? "btn-light text-dark" : "btn-danger"} rounded-circle p-2 d-flex align-items-center justify-content-center shadow-sm`}
          style={{ width: "42px", height: "42px" }}
          onClick={toggleMic}
          title="Toggle Microphone"
        >
          <ion-icon name={micActive ? "mic" : "mic-off"} style={{ fontSize: "18px" }}></ion-icon>
        </button>

        <button
          className={`btn ${camActive ? "btn-light text-dark" : "btn-danger"} rounded-circle p-2 d-flex align-items-center justify-content-center shadow-sm`}
          style={{ width: "42px", height: "42px" }}
          onClick={toggleCam}
          title="Toggle Camera"
        >
          <ion-icon name={camActive ? "videocam" : "videocam-off"} style={{ fontSize: "18px" }}></ion-icon>
        </button>

        <button
          className={`btn ${isSharingScreen ? "btn-primary" : "btn-light text-dark"} rounded-circle p-2 d-flex align-items-center justify-content-center shadow-sm`}
          style={{ width: "42px", height: "42px" }}
          onClick={handleScreenShareClick}
          title={isSharingScreen ? "Stop Screen Share" : "Share Screen"}
        >
          <ion-icon name={isSharingScreen ? "desktop" : "desktop-outline"} style={{ fontSize: "18px" }}></ion-icon>
        </button>

        <button
          className={`btn ${isHandRaised ? "btn-warning text-dark fw-bold" : "btn-light text-dark"} rounded-circle p-2 d-flex align-items-center justify-content-center shadow-sm`}
          style={{ width: "42px", height: "42px" }}
          onClick={toggleRaiseHand}
          title={isHandRaised ? "Lower Hand" : "Raise Hand"}
        >
          <ion-icon name={isHandRaised ? "hand-left" : "hand-left-outline"} style={{ fontSize: "18px" }}></ion-icon>
        </button>

        <button
          className="btn btn-light text-danger rounded-circle p-2 d-flex align-items-center justify-content-center shadow-sm"
          style={{ width: "42px", height: "42px" }}
          onClick={sendHeartReaction}
          title="React Heart"
        >
          <ion-icon name="heart" style={{ fontSize: "18px" }}></ion-icon>
        </button>

        <div className="position-relative">
          <button
            className={`btn ${showChat ? "btn-primary text-white" : "btn-light text-dark"} rounded-circle p-2 d-flex align-items-center justify-content-center shadow-sm`}
            style={{ width: "42px", height: "42px" }}
            onClick={() => setShowChat(!showChat)}
            title={showChat ? "Close Chat" : "Open Meeting Chat"}
          >
            <ion-icon name={showChat ? "chatbubbles" : "chatbubbles-outline"} style={{ fontSize: "18px" }}></ion-icon>
          </button>
          {!showChat && unreadChatCount > 0 && (
            <span
              className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger border border-light text-white fw-bold shadow-sm"
              style={{ fontSize: "10px", padding: "3px 6px" }}
            >
              {unreadChatCount}
            </span>
          )}
        </div>
      </div>

      {/* Request Screen Share Confirmation Modal */}
      {showScreenShareRequestModal && (
        <div className="modal d-block d-flex align-items-center justify-content-center" style={{ backgroundColor: "rgba(15, 23, 42, 0.65)", backdropFilter: "blur(6px)", zIndex: 3000 }}>
          <div className="modal-dialog modal-dialog-centered modal-sm px-3 w-100" style={{ maxWidth: "380px" }}>
            <div className="modal-content border-0 shadow-lg rounded-4 p-4 text-center text-dark bg-white" style={{ border: "1px solid #e2e8f0" }}>
              <div className="mb-3">
                <span className="p-3 rounded-circle bg-primary bg-opacity-10 text-primary d-inline-flex align-items-center justify-content-center mb-2">
                  <ion-icon name="desktop-outline" style={{ fontSize: "28px" }}></ion-icon>
                </span>
                <h6 className="fw-bold text-dark mb-2">Request Screen Share</h6>
                <p className="text-muted small mb-0" style={{ fontSize: "13px", lineHeight: "1.4" }}>
                  The professor requires permission to share screens. Would you like to request permission?
                </p>
              </div>
              <div className="d-flex gap-2 justify-content-center">
                <button
                  className="btn btn-outline-secondary rounded-pill fw-semibold py-2 px-3 flex-grow-1 shadow-sm"
                  style={{ fontSize: "13px" }}
                  onClick={() => setShowScreenShareRequestModal(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary rounded-pill fw-semibold py-2 px-3 flex-grow-1 shadow-sm"
                  style={{ fontSize: "13px" }}
                  onClick={submitScreenShareRequest}
                >
                  Request Permission
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Waiting for Approval Modal */}
      {isWaitingForApproval && (
        <div className="modal d-block d-flex align-items-center justify-content-center" style={{ backgroundColor: "rgba(15, 23, 42, 0.65)", backdropFilter: "blur(6px)", zIndex: 3000 }}>
          <div className="modal-dialog modal-dialog-centered modal-sm px-3 w-100" style={{ maxWidth: "360px" }}>
            <div className="modal-content border-0 shadow-lg rounded-4 p-4 text-center text-dark bg-white" style={{ border: "1px solid #e2e8f0" }}>
              <div className="mb-3">
                <div className="spinner-border text-primary mb-3" role="status" style={{ width: "3rem", height: "3rem" }}>
                  <span className="visually-hidden">Loading...</span>
                </div>
                <h6 className="fw-bold text-dark mb-1">Waiting for Approval</h6>
                <p className="text-muted small mb-0 px-2" style={{ fontSize: "13px", lineHeight: "1.4" }}>
                  Your request has been sent to the professor. Please wait for approval...
                </p>
              </div>
              <div className="d-grid">
                <button
                  className="btn btn-outline-secondary rounded-pill fw-semibold py-2 shadow-sm"
                  style={{ fontSize: "13px" }}
                  onClick={() => setIsWaitingForApproval(false)}
                >
                  Cancel Request
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Ending Live Session */}
      {showConfirmModal && (
        <div className="modal d-block d-flex align-items-center justify-content-center" style={{ backgroundColor: "rgba(15, 23, 42, 0.65)", backdropFilter: "blur(6px)", zIndex: 3000 }}>
          <div className="modal-dialog modal-dialog-centered modal-sm px-3 w-100" style={{ maxWidth: "380px" }}>
            <div className="modal-content border-0 shadow-lg rounded-4 p-4 text-center text-dark bg-white" style={{ border: "1px solid #e2e8f0" }}>
              <div className="mb-3">
                <span className="p-3 rounded-circle bg-danger bg-opacity-10 text-danger d-inline-flex align-items-center justify-content-center mb-2">
                  <ion-icon name="power-outline" style={{ fontSize: "28px" }}></ion-icon>
                </span>
                <h6 className="fw-bold text-dark mb-2">End Live Session?</h6>
                <p className="text-muted small mb-0" style={{ fontSize: "13px", lineHeight: "1.4" }}>
                  Are you sure you want to end this live session for everyone? This will delete the class card.
                </p>
              </div>
              <div className="d-flex gap-2 justify-content-center">
                <button
                  className="btn btn-outline-secondary rounded-pill fw-semibold py-2 px-3 flex-grow-1 shadow-sm"
                  style={{ fontSize: "13px" }}
                  onClick={() => setShowConfirmModal(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-danger rounded-pill fw-semibold py-2 px-3 flex-grow-1 shadow-sm"
                  style={{ fontSize: "13px" }}
                  onClick={confirmEndLiveSession}
                >
                  End Session
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error / Notice Modal */}
      {showErrorModal && (
        <div className="modal d-block d-flex align-items-center justify-content-center" style={{ backgroundColor: "rgba(15, 23, 42, 0.65)", backdropFilter: "blur(6px)", zIndex: 3000 }}>
          <div className="modal-dialog modal-dialog-centered modal-sm px-3 w-100" style={{ maxWidth: "360px" }}>
            <div className="modal-content border-0 shadow-lg rounded-4 p-3 text-center text-dark bg-white" style={{ border: "1px solid #e2e8f0" }}>
              <div className="mb-3">
                <span className="p-2 rounded-circle bg-danger bg-opacity-10 text-danger d-inline-flex align-items-center justify-content-center mb-2">
                  <ion-icon name="alert-circle-outline" style={{ fontSize: "26px" }}></ion-icon>
                </span>
                <h6 className="fw-bold text-dark mb-1">Notice</h6>
                <p className="text-muted small mb-0 px-2" style={{ fontSize: "13px", lineHeight: "1.4" }}>
                  {modalErrorMessage}
                </p>
              </div>
              <div className="d-grid">
                <button
                  className="btn btn-primary rounded-pill fw-semibold py-2 shadow-sm"
                  style={{ fontSize: "13px" }}
                  onClick={() => setShowErrorModal(false)}
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Live Has Ended Modal */}
      {showEndedModal && (
        <div className="modal d-block d-flex align-items-center justify-content-center" style={{ backgroundColor: "rgba(15, 23, 42, 0.65)", backdropFilter: "blur(6px)", zIndex: 3000 }}>
          <div className="modal-dialog modal-dialog-centered modal-sm px-3 w-100" style={{ maxWidth: "360px" }}>
            <div className="modal-content border-0 shadow-lg rounded-4 p-3 text-center text-dark bg-white" style={{ border: "1px solid #e2e8f0" }}>
              <div className="mb-3">
                <span className="p-2 rounded-circle bg-danger bg-opacity-10 text-danger d-inline-flex align-items-center justify-content-center mb-2">
                  <ion-icon name="stop-circle-outline" style={{ fontSize: "26px" }}></ion-icon>
                </span>
                <h6 className="fw-bold text-dark mb-1">Live Has Ended</h6>
                <p className="text-muted small mb-0 px-2" style={{ fontSize: "13px", lineHeight: "1.4" }}>
                  The professor has ended this live session.
                </p>
              </div>
              <div className="d-grid">
                <button
                  className="btn btn-primary rounded-pill fw-semibold py-2 shadow-sm"
                  style={{ fontSize: "13px" }}
                  onClick={() => navigate("/liveClass")}
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default OnlineRoom;