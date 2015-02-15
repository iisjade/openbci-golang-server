package main

import (
	"html/template"
	"net/http"
	"strconv"
	"strings"
)

var channelOn = map[string]string{"1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&", "8": "*"}
var gainMap = map[string]float64{"0": 1.0, "1": 2.0, "2": 4.0, "3": 6.0, "4": 8.0, "5": 12.0, "6": 24.0}

func jsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	p := strings.Split(r.URL.Path, "/")
	f := p[len(p)-1]
	http.ServeFile(w, r, "js/"+f)
}

func rootHandler(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.Error(w, "Not found", 404)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	rootTempl := template.Must(template.ParseFiles("static/index.html"))
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	rootTempl.Execute(w, r.Host)
}

func parseCommand(path string) string {
	var command string
	p := strings.Split(path, "/")
	channel := p[2]
	switch {
	case len(p) < 4:
		command = ""
	case p[3] == "true":
		command = channelOn[channel]
	case p[3] == "false":
		command = channel
	case channel == "0": //send command to all channels
		c := make([]string, 8)
		for i := 0; i < 8; i++ {
			c[i] = p[3][0:1] + strconv.Itoa(i+1) + p[3][2:]
			mc.gain[i] = gainMap[p[3][3:4]]
		}
		command = c[0] + c[1] + c[2] + c[3] + c[4] + c[5] + c[6] + c[7]
	case p[3][0:1] == "x":
		ci := channel[0] - 49
		mc.gain[ci] = gainMap[p[3][3:4]]
		command = p[3]
	}
	return command
}

func commandHandler(w http.ResponseWriter, r *http.Request) {
	if strings.Contains(r.URL.Path, "/x/") == false {
		http.Error(w, "Not found", 404)
		return
	}
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	command := parseCommand(r.URL.Path)
	if len(command) > 72 {
		http.Error(w, "Method not allowed", 405)
		return
	}
	for _, c := range command {
		mc.WriteStream <- string(c)
	}
}

func openHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	mc.Open()
}

func resetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	mc.ResetButton <- true
}

func startHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	mc.WriteStream <- "b"
}

func stopHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	mc.ResetButton <- false
}

func closeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	mc.QuitButton <- true
}

func testHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	go mc.GenTestPackets()
}

func wsPacketHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	wsConn, err := NewWSConn(w, r)
	if err != nil {
		http.Error(w, "Method not allowed", 405)
		return
	}
	h.register <- wsConn
	go wsConn.WritePump()
}
