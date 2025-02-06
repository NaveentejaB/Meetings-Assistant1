import React, { useState, useRef, useEffect } from 'react';
import { Video, StopCircle,X } from 'lucide-react';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import {GoogleGenerativeAI} from '@google/generative-ai';

const Assistant = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState('');
  const [videoStream, setVideoStream] = useState(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [microphoneTranscript, setMicrophoneTranscript] = useState('');
  const [aiResponse, setAiResponse] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  

  const mediaRecorderRef = useRef(null);
  const microphoneRecorderRef = useRef(null);
  const videoRef = useRef(null);
  const timerRef = useRef(null);
  const deepgramConnectionRef = useRef(null);
  const micDeepgramConnectionRef = useRef(null);
  const lastProcessedTextRef = useRef('');



  const startTimer = () => {
    timerRef.current = setInterval(() => {
      setRecordingTime(prev => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
      setRecordingTime(0); // Reset timer when stopped
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')} : ${secs.toString().padStart(2, '0')}`;
  };

  // Function to detect questions in text
  const detectQuestion = (text) => {
    const questionPatterns = [
      /\?$/,  // Ends with question mark
      /^(what|who|where|when|why|how|can|could|would|should|is|are|do|does|did)/i  // Starts with question words
    ];
    return questionPatterns.some(pattern => pattern.test(text.trim()));
  };

  const processTranscript = async (newText, source) => {
    const fullText = source === 'screen' ? transcript : microphoneTranscript;
    const sentences = newText
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const sentence of sentences) {
      if (detectQuestion(sentence) && !lastProcessedTextRef.current.includes(sentence)) {
        lastProcessedTextRef.current = sentence;
        await processQuestionWithAI(sentence, source);
      }
    }
  };

  // Function to process question with AI
  const google_api_key = import.meta.env.VITE_GOOGLE_AI;
  console.log('google_api_key: ',google_api_key);
  const genAI = new GoogleGenerativeAI(google_api_key);

  const processQuestionWithAI = async (question, source) => {
  setIsProcessing(true);

  try {
    // Initialize the model (using gemini-pro which is the free version)
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    // Generate content
    const result = await model.generateContent(question);
    const response = await result.response;
    const aiResponse = response.text();

    setChatMessages(prev => [...prev,
      {
        type: 'question',
        text: question,
        source: source,
        timestamp: new Date().toISOString()
      },
      {
        type: 'answer',
        text: aiResponse || "I apologize, but I couldn't process that question.",
        timestamp: new Date().toISOString()
      }
    ]);
  } catch (error) {
    console.error('Error processing with Gemini:', error);
    
    const errorMessage = error.message || 
      "Sorry, I encountered an error processing your question.";
    
    setChatMessages(prev => [...prev,
      {
        type: 'question',
        text: question,
        source: source,
        timestamp: new Date().toISOString()
      },
      {
        type: 'answer',
        text: errorMessage,
        timestamp: new Date().toISOString()
      }
    ]);
  } finally {
    setIsProcessing(false);
  }
};

  const setupDeepgramTranscription = async (audioStream, setTranscriptFunc,source) => {
    try {
      const deep_gram_key = import.meta.env.VITE_DEEPGRAM_API
      console.log('deep_gram_key: ',deep_gram_key);
      const deepgram = createClient(deep_gram_key);

      const connection = await deepgram.listen.live({
        model: "nova-2",
        language: "en-US",
        smart_format: true,
      });

      connection.on(LiveTranscriptionEvents.Open, () => {
        console.log("Deepgram connection opened");

        connection.on(LiveTranscriptionEvents.Transcript, (data) => {
          const transcriptText = data.channel.alternatives[0].transcript;
          if (transcriptText && data.is_final) {
            setTranscriptFunc(prev => {
              const newText = prev + ' ' + transcriptText;
              processTranscript(transcriptText, source);
              return newText;
            });
          }
        });

        connection.on(LiveTranscriptionEvents.Error, (err) => {
          console.error('Deepgram Error:', err);
          setError('Transcription service error');
        });

        connection.on(LiveTranscriptionEvents.Close, () => {
          console.log("Deepgram connection closed");
        });

        const mediaRecorder = new MediaRecorder(audioStream, {
          mimeType: 'audio/webm',
        });

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0 && connection.getReadyState() === 1) {
            connection.send(event.data);
          }
        };

        mediaRecorder.start(200)

        mediaRecorder.onerror = (event) => {
          console.error('Media Recorder Error:', event);
        };

        return { connection, mediaRecorder };
      });

      return connection;
    } catch (err) {
      setError(`Failed to setup transcription: ${err.message}`);
      return null;
    }
  };

  const startRecording = async () => {
    try {
      // To clear previous recordings
      clearRecordings();

      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      const audioTracks = displayStream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('No audio track found. Please select "Share audio".');
      }

      const combinedStream = new MediaStream([
        ...displayStream.getVideoTracks(),
        ...audioTracks
      ]);

      const audioStream = new MediaStream(audioTracks);
      const screenDeepgramResult = await setupDeepgramTranscription(audioStream, setTranscript);
      if (screenDeepgramResult) {
        deepgramConnectionRef.current = { connection: screenDeepgramResult };
      }

      // Start microphone recording
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      const micDeepgramResult = await setupDeepgramTranscription(micStream, setMicrophoneTranscript);
      if (micDeepgramResult) {
        const micRecorder = new MediaRecorder(micStream, {
          mimeType: 'audio/webm',
        });

        microphoneRecorderRef.current = micRecorder;
        micDeepgramConnectionRef.current = {
          connection: micDeepgramResult,
          mediaRecorder: micRecorder,
          stream: micStream
        };

        micRecorder.start(200);
      }

      const mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 3000000,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = combinedStream;
        videoRef.current.muted = true;
      }

      mediaRecorderRef.current = mediaRecorder;
      setVideoStream(combinedStream);

      mediaRecorder.start();
      setIsRecording(true);
      startTimer();

    } catch (err) {
      setError(`Failed to start recording: ${err.message}`);
      console.error('Error:', err);
    }
  };

  const stopRecording = async () => {
    try {
      if (mediaRecorderRef.current && isRecording) {
        mediaRecorderRef.current.stop();
        
        if (videoStream) {
          videoStream.getTracks().forEach(track => {
            track.stop();
            track.enabled = false;
          });
          setVideoStream(null);
        }

        if (deepgramConnectionRef.current?.connection) {
          await deepgramConnectionRef.current.connection.finish();
        }

        // Stop microphone recording
        if (micDeepgramConnectionRef.current) {
          await micDeepgramConnectionRef.current.connection.finish();
          micDeepgramConnectionRef.current.mediaRecorder.stop();
          micDeepgramConnectionRef.current.stream.getTracks().forEach(track => {
            track.stop();
            track.enabled = false;
          });
        }

        // Clear refs
        mediaRecorderRef.current = null;
        deepgramConnectionRef.current = null;
        micDeepgramConnectionRef.current = null;

        if (videoRef.current) {
          videoRef.current.srcObject = null;
        }

        setIsRecording(false);
        stopTimer();
      }
    } catch (err) {
      console.error('Error stopping recording:', err);
      setError('Failed to stop recording properly');
    }
  };
  const clearRecordings = () => { 
    setChatMessages([]);
    setTranscript('');
    setMicrophoneTranscript('');
  }
  useEffect(() => {
    return () => {
      stopRecording();
      stopTimer();
    };
  }, []);

  return (
    <div className="w-full h-screen">
      <div className="w-full h-full border rounded-lg shadow-lg bg-white">
        <div className="w-full h-full p-4">
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4">
              <span className="block sm:inline">{error}</span>
            </div>
          )}
          {/* Controls */}
          <div className="flex gap-4 justify-center items-center mb-6">
            {!isRecording ? (
              <button
                onClick={startRecording}
                className="flex items-center gap-2 bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 transition-colors"
              >
                <Video className="h-4 w-4" />
                Start Recording
              </button>
            ) : (
              <button
                onClick={stopRecording}
                className="flex items-center gap-2 bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 transition-colors"
              >
                <StopCircle className="h-4 w-4" />
                Stop Recording ({formatTime(recordingTime)})
              </button>
            )}
            <button
              onClick={clearRecordings}
              className="flex items-center gap-2 bg-black hover:bg-gray-900 text-white px-4 py-2 rounded-md  transition-colors"
            >
              <X className="h-4 w-4" />
              Clear Recordings
            </button>
          </div>
          <div className='grid grid-cols-3 gap-4 h-[calc(100vh-8rem)]'>
            {/* Left Column - Video and Transcript 1 */}
            <div className='flex flex-col h-full'>
              <div className="aspect-video bg-gray-900 rounded-lg mb-4">
                <video
                  ref={videoRef}
                  autoPlay
                  muted={true}
                  playsInline
                  className="w-full h-full"
                />
              </div>
              <div className="flex-1 bg-gray-50 p-4 rounded-lg">
                <h3 className="font-semibold mb-2">Screen Recording Transcript</h3>
                <div className="h-[calc(100%-2rem)] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-400 scrollbar-track-transparent">
                  <div className="text-gray-700">
                    {transcript || "Screen recording transcript will appear here..."}
                  </div>
                </div>
              </div>
            </div>
            {/* middle region */}
            <div className="bg-gray-50 p-4 rounded-lg overflow-hidden">
              <div className="h-full flex flex-col">
                <div className="flex-1 overflow-y-auto scrollbar scrollbar-thumb-gray-400 scrollbar-track-gray-100 pr-2">
                  <div className="space-y-4">
                    {chatMessages.map((message, index) => (
                      <div
                        key={index}
                        className={`${
                          message.type === 'question'
                            ? 'bg-blue-100 ml-auto'
                            : 'bg-white mr-auto'
                        } p-4 rounded-lg shadow max-w-[80%]`}
                      >
                        <div className="text-sm text-gray-500 mb-1">
                          {message.type === 'question' && `Source: ${message.source}`}
                        </div>
                        <div className="text-gray-700">{message.text}</div>
                      </div>
                    ))}
                    {isProcessing && (
                      <div className="bg-gray-100 p-4 rounded-lg shadow">
                        Processing...
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            {/* right most region */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="font-semibold mb-2">Microphone Transcript</h3>
              <div className="h-[calc(100%-2rem)] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-400 scrollbar-track-transparent">
                <div className="text-gray-700">
                  {microphoneTranscript || "Microphone transcript will appear here..."}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Assistant;