import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';

import * as poseDetection from '@tensorflow-models/pose-detection';
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl';
import { Keypoint } from '@tensorflow-models/pose-detection';
import { of } from 'rxjs';
import { delay, flatMap, repeat } from 'rxjs/operators';

const FRAME_REFRESH_MS = 50;
const POSE_SCORE_THRESOLD = 0.275;
const Y_MOVEMENT_THRESOLD = 0.01;
const BALL_RADIUS_PX = 5;
const PADDLE_Y_DELTA = 25;
const BALL_COLOR = 'red';
const BALL_SPEED = 20;
const SCORES_COLOR = 'white';
const PADDLE_COLOR = 'white';
const PADDLE_WIDTH = 10;
const PADDLE_HEIGHT = 150;
const PADDLE_MARGIN = 20;

enum PlayerType {
  COMPUTER, HUMAN
}

interface Point {
  x: number;
  y: number;
}

@Component({
  selector: 'app-pong',
  templateUrl: './pong.component.html',
  styleUrls: ['./pong.component.css']
})
export class PongComponent implements AfterViewInit {

  wristPose?: Keypoint;

  detector!: poseDetection.PoseDetector;

  @ViewChild('webcam') webcam!: ElementRef;

  @ViewChild('canvas') canvas!: ElementRef;

  context!: CanvasRenderingContext2D;

  pointsComputer = 0;

  pointsPlayer = 0;

  paddleYComputer!: number;

  paddleYPlayer!: number;

  ballPosition!: Point;

  ballDirection!: Point;

  constructor() { }

  async ngAfterViewInit() {
    // canvas
    this.context = this.canvas.nativeElement.getContext('2d');

    // MoveNet detector
    const detectorConfig = { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING };
    this.detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, detectorConfig);

    // webcam
    const video = this.webcam.nativeElement;

    if (navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true })
        video.srcObject = stream;
      } catch (err) {
        console.error(err);
      }
    }

    video.addEventListener('loadeddata', () => {
      const poll = of({}).pipe(
        flatMap(this.onUpdate.bind(this)),
        delay(FRAME_REFRESH_MS),
        repeat()
      );

      poll.subscribe();
    });

    this.paddleYComputer = this.canvasHeight / 2;
    this.paddleYPlayer = this.canvasHeight / 2;
  }

  get canvasWidth(): number {
    return this.canvas.nativeElement.width;
  }

  get canvasHeight(): number {
    return this.canvas.nativeElement.height;
  }

  getCanvasPointX(x: number): number {
    return Math.floor(this.canvasWidth * x);
  }

  getCanvasPointY(y: number): number {
    return Math.floor(this.canvasHeight * y);
  }

  drawPoint(x: number, y: number): void {
    this.context.beginPath();
    this.context.arc(this.canvasWidth - 20, this.getCanvasPointY(y) - PADDLE_Y_DELTA, BALL_RADIUS_PX, 0, 2 * Math.PI);
    this.context.fillStyle = BALL_COLOR;
    this.context.fill();
  }

  drawPaddle(centerY: number, playerType: PlayerType): void {
    this.context.beginPath();
    console.log(playerType, PlayerType.HUMAN)
    this.context.fillRect(
      playerType == PlayerType.HUMAN ? this.canvasWidth - PADDLE_MARGIN - PADDLE_WIDTH : PADDLE_MARGIN,
      this.getCanvasPointY(centerY) - PADDLE_HEIGHT / 2,
      PADDLE_WIDTH / 2,
      PADDLE_HEIGHT / 2
    );

    this.context.fillStyle = PADDLE_COLOR;
    this.context.fill();
  }

  async detectRightWristPose(): Promise<Keypoint | undefined> {
    const poses = await this.detector.estimatePoses(this.webcam.nativeElement);
    const keypoints = poseDetection.calculators.keypointsToNormalizedKeypoints(poses[0].keypoints, {
      width: this.webcam.nativeElement.videoWidth,
      height: this.webcam.nativeElement.videoHeight
    });
    const rightWristPose = keypoints.find(keypoint => keypoint.name === 'right_wrist');
    return rightWristPose;
  }

  async onUpdate() {
    const newWristPose = await this.detectRightWristPose()
    let yDelta = 0;

    if (newWristPose && this.wristPose) {
      yDelta = Math.abs(newWristPose.y - this.wristPose.y);
    }

    if (newWristPose && newWristPose.score
      && newWristPose.score >= POSE_SCORE_THRESOLD
      && yDelta >= Y_MOVEMENT_THRESOLD) {
      this.clearCanvas();
      this.drawHalfLine();
      this.drawScores();
      this.drawPaddle(newWristPose.y, PlayerType.HUMAN);
      this.drawPaddle(0.5, PlayerType.COMPUTER);
    }
    
    if (newWristPose) {
      this.wristPose = newWristPose;
    }
  }

  clearCanvas(): void {
    this.context.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
  }

  drawScores(): void {
    this.context.font = "96px VT323";
    this.context.fillStyle = SCORES_COLOR;
    this.context.textAlign = 'center';
    this.context.fillText(this.pointsComputer.toString(), this.canvasWidth / 4, 75);
    this.context.fillText(this.pointsPlayer.toString(), this.canvasWidth / 4 * 3, 75);
  }

  drawHalfLine(): void {
    this.context.strokeStyle = SCORES_COLOR;
    this.context.beginPath();
    this.context.setLineDash([5, 15]);
    this.context.moveTo(this.canvasWidth / 2, 0);
    this.context.lineTo(this.canvasWidth / 2, this.canvasHeight);
    this.context.stroke();
  }
}
