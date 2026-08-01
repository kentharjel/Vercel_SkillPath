import { useState } from 'react'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import { Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import About from './pages/About'
import GetStarted from './pages/Getstarted'
import LearningPaths from './pages/Learningpaths'
import Classes from './pages/Classes'
import Progress from './pages/Progress'
import Achievements from './pages/Achievements'
import Login from './pages/Login'
import ViewPath from './skillPath/Viewpath'
import ViewClass from './classes/Viewclass'
import SignUp from './pages/Signup'
import Admin from './Admin'
import ViewLesson from './classes/Viewlesson'
import TakeQuiz from './classes/Takequiz'
import Profile from './pages/Profile'
import Requests from './pages/Requests'
import LiveClass from './pages/LiveClass'
import OnlineRoom from './pages/OnlineRoom'
import Preferences from './pages/preferences'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <div className="d-flex flex-column min-vh-100">
        {/* Top Navbar Area - Wrapped with an ID wrapper for DOM manipulation control */}
        <div id="main-global-navbar">
          <Navbar />
        </div>

        {/* Main content area */}
        <main className="flex-grow-1 container py-4">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<About />} />
            <Route path="/getstarted" element={<GetStarted />} />
            <Route path='/learningpaths' element={<LearningPaths />} />
            <Route path="/classes" element={<Classes />} />
            <Route path="/progress" element={<Progress />} />
            <Route path="/achievements" element={<Achievements />} />
            <Route path="/login" element={<Login />} />
            <Route path="/viewpath" element={<ViewPath />} />
            <Route path="/viewclass" element={<ViewClass />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/viewlesson" element={<ViewLesson />} />
            <Route path="/takequiz" element={<TakeQuiz />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/requests" element={<Requests />} />
            <Route path="/liveclass" element={<LiveClass />} />
            <Route path="/room/:channelName" element={<OnlineRoom />} />
            <Route path="/preferences" element={<Preferences />} />
          </Routes>
        </main>

        {/* Bottom */}
        <Footer />
      </div>
    </>
  )
}

export default App