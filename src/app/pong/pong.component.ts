import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';

import * as poseDetection from '@tensorflow-models/pose-detection';
import '@tensorflow/tfjs-backend-webgl';
import { Keypoint } from '@tensorflow-models/pose-detection';
import { of } from 'rxjs';
import { delay, flatMap, repeat } from 'rxjs/operators';

const HAND_DETECTION_MS = 35;
const FRAME_REFRESH_MS = 20;
const POSE_SCORE_THRESOLD = 0.275;
const Y_MOVEMENT_THRESOLD = 0.015;
const BALL_RADIUS_PX = 10;
const BALL_COLOR = 'red';
const BALL_SPEED = 50;
const SCORES_COLOR = 'white';
const PADDLE_COLOR = 'white';
const PADDLE_WIDTH = 10;
const PADDLE_HEIGHT = 70;
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

  paddleYComputer = 0.5;

  ballPosition: Point = { x: 0.5, y: 0.5 };

  ballDirection: Point = { x: 0.2, y: -0.98 };

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
      const paddleUpdate = of({}).pipe(
        flatMap(this.updatePaddle.bind(this)),
        delay(HAND_DETECTION_MS),
        repeat()
      );

      const gameStateUpdate = of({}).pipe(
        flatMap(this.updateGameState.bind(this)),
        delay(FRAME_REFRESH_MS),
        repeat()
      );

      paddleUpdate.subscribe();
      gameStateUpdate.subscribe();
    });
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

  drawBall(x: number, y: number): void {
    this.context.beginPath();
    this.context.arc(this.getCanvasPointX(x), this.getCanvasPointY(y), BALL_RADIUS_PX, 0, 2 * Math.PI);
    this.context.fillStyle = BALL_COLOR;
    this.context.fill();
  }

  drawPaddle(centerY: number, playerType: PlayerType): void {
    this.context.beginPath();
    this.context.fillStyle = PADDLE_COLOR;
    this.context.fillRect(
      playerType == PlayerType.HUMAN ? this.canvasWidth - PADDLE_MARGIN - PADDLE_WIDTH : PADDLE_MARGIN,
      this.getCanvasPointY(centerY) - PADDLE_HEIGHT / 2,
      PADDLE_WIDTH,
      PADDLE_HEIGHT
    );
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

  getNormalizedPosition(keypoint: Keypoint | undefined): Keypoint | undefined {
    if (!keypoint) {
      return;
    }

    // ignore segments of the video image
    const minY = 0.25;
    const maxY = 0.98;

    if (keypoint.y < minY) {
      keypoint.y = 0;
    } else if (keypoint.y > maxY) {
      keypoint.y = 1;
    } else {
      keypoint.y = (keypoint.y - minY) / (maxY - minY); // normalize y to [0, 1] range
    }

    return keypoint;
  }

  moveBall(): void {
    this.ballPosition = {
      x: this.ballPosition.x + this.ballDirection.x / BALL_SPEED,
      y: this.ballPosition.y + this.ballDirection.y / BALL_SPEED
    };
  }

  async updatePaddle() {
    const newWristPose = this.getNormalizedPosition(await this.detectRightWristPose());

    if (!this.wristPose) {
      this.wristPose = newWristPose;
    }

    let yDelta = 0;

    if (newWristPose && this.wristPose) {
      yDelta = Math.abs(newWristPose.y - this.wristPose.y);
    }

    if (newWristPose && newWristPose.score && newWristPose.score >= POSE_SCORE_THRESOLD
      && yDelta >= Y_MOVEMENT_THRESOLD) {
      this.wristPose = newWristPose;
    }
  }

  async updateGameState() {
    // collision with paddles
    const ballX = this.getCanvasPointX(this.ballPosition.x);
    const ballY = this.getCanvasPointY(this.ballPosition.y);
    const leftPaddleY = this.getCanvasPointY(this.paddleYComputer);
    const rightPaddleY = this.getCanvasPointY(this.wristPose?.y || 0.5);

    if ((ballY >= leftPaddleY - PADDLE_HEIGHT / 2
      && ballY <= leftPaddleY + PADDLE_HEIGHT / 2
      && ballX - BALL_RADIUS_PX <= PADDLE_MARGIN + PADDLE_WIDTH)
      || (ballY >= rightPaddleY - PADDLE_HEIGHT / 2
        && ballY <= rightPaddleY + PADDLE_HEIGHT / 2
        && ballX + BALL_RADIUS_PX >= this.canvasWidth - PADDLE_MARGIN - PADDLE_WIDTH)) {
      this.ballDirection.x = -this.ballDirection.x;
      // TODO: rotate ball direction
    }

    // collision with left-right borders
    if (this.getCanvasPointX(this.ballPosition.x) <= BALL_RADIUS_PX) {
      this.pointsComputer++;
      this.ballPosition.x = 0.5;
      this.ballPosition.y = 0.5;
      this.ballDirection.x = 1;
      this.ballDirection.y = 0
    } else if (this.getCanvasPointX(this.ballPosition.x) >= this.canvasHeight - BALL_RADIUS_PX) {
      this.pointsPlayer++;
      this.ballPosition.x = 0.5;
      this.ballPosition.y = 0.5;
      this.ballDirection.x = -1;
      this.ballDirection.y = 0
    }

    // collision with top-bottom borders
    if (this.getCanvasPointY(this.ballPosition.y) <= BALL_RADIUS_PX
      || this.getCanvasPointY(this.ballPosition.y) >= this.canvasHeight - BALL_RADIUS_PX) {
      this.ballDirection.y = -this.ballDirection.y;
    }

    // TODO: move computer paddle based on some advanced strategy
    this.paddleYComputer = this.ballPosition.y;

    // refresh UI
    this.clearCanvas();
    this.drawHalfLine();
    this.drawScores();
    this.moveBall();
    this.drawBall(this.ballPosition.x, this.ballPosition.y);
    this.drawPaddle(this.paddleYComputer, PlayerType.COMPUTER);
    if (this.wristPose) {
      this.drawPaddle(this.wristPose.y, PlayerType.HUMAN);
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
