package main

import (
	"flag"
	"log"
	"net/http"
	"time"
)

var mc *MindController = NewMindController()
var addr = flag.String("addr", ":8888", "http service address")

const (
	readBufferSize  = 1024
	packetBatchSize = 100
)

func sendPackets() {
	last_second := time.Now().UnixNano()
	second := time.Now().UnixNano()

	go mc.serialDevice.readWriteClose()

	pb := NewPacketBatcher()
	for i := 1; ; i++ {
		p := <-mc.PacketStream
		pb.packets[i%packetBatchSize] = p

		if i%packetBatchSize == 0 {
			pb.batch()
			h.broadcast <- pb
			pb = NewPacketBatcher()
		}
		if i%250 == 0 {
			second = time.Now().UnixNano()
			log.Println(second-last_second, "nanoseconds have elapsed between 1250 samples.")
			log.Println("Gain changer:", mc.gain)
			//fmt.Println("Chans 1-4:", p.chan1, p.chan2, p.chan3, p.chan4)
			//fmt.Println("Chans 5-8:", p.chan5, p.chan6, p.chan7, p.chan8)
			//fmt.Println("Acc Data:", p.accX, p.accY, p.accZ)
			last_second = second
		}
	}
}

func main() {
	http.HandleFunc("/", rootHandler)
	http.HandleFunc("/x/", commandHandler)
	http.HandleFunc("/ws", wsPacketHandler)
	http.HandleFunc("/open", openHandler)
	http.HandleFunc("/reset", resetHandler)
	http.HandleFunc("/start", startHandler)
	http.HandleFunc("/stop", stopHandler)
	http.HandleFunc("/close", closeHandler)
	go h.run()
	for {
		http.ListenAndServe(*addr, nil)
	}
}